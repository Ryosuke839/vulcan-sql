import {
  APISchema,
  ArtifactBuilderOptions,
  PersistentStore,
  TYPES,
  VulcanExtensionId,
  VulcanInternalExtension,
} from '@vulcan-sql/core';
import { inject } from 'inversify';
import { chain } from 'lodash';
import * as oas3 from 'openapi3-ts';
import { createStorageService } from './storageService';
import { BaseStorageService, ObjectBasicInfo } from '@canner/canner-storage';
import { CannerStoreConfig, getEnvConfig } from './config';
export interface RawBuiltInArtifact {
  // key is source name, value is combined sql js executable code
  templates: Record<string, string>;
  schemas: APISchema[];
  // specs content may be different according to the different spec generator, so we use the record type
  specs: Record<string, any>;
}

export type BuiltInArtifact = RawBuiltInArtifact & {
  specs: {
    oas3: oas3.OpenAPIObject;
  };
};

/**
 * The indicator file record the workspace sql name, every deployed and latest deployed version of artifact folder name
 */
interface ArtifactIndicator {
  /**
   * {
   *  "master": "711c034c",
   *  "3f051d57": "1685207455869_3f051d57",
   *  "711c034c": "1685213384299_711c034c",
   *  "d9e3aa9f-fb6c-4a85-aaf2-bb766a66df83": "w05228",
   * }
   */
  // The latest deployed artifact folder sha name
  master: string;
  // The every deployed artifact folder name and workspace sql name
  [key: string]: string;
}

// key is workspaceSqlName, value is artifact buffer content
interface WorkspaceArtifact {
  workspaceSqlName: string;
  artifact: RawBuiltInArtifact;
}
/**
 * Used the string to identify the extension Id not by the enum "ArtifactBuilderProviderType" because the enum is define in the "core" package,
 * and the canner extensions is only used for Canner integration, so we could add the "Canner" type in the "ArtifactBuilderProviderType",
 * If we use the create an other enum and union "ArtifactBuilderProviderType", the enum is only has "Canner" type, so it seems define a other enum is unnecessary,
 *  */
@VulcanInternalExtension()
@VulcanExtensionId('Canner')
export class CannerPersistenceStore extends PersistentStore {
  private filePath: string;
  private logger = this.getLogger();
  private vulcanFolderPathPattern = new RegExp('([a-zA-Z0-9-]+)/vulcansql');
  private indicatorPathPattern: RegExp;
  private envConfig: CannerStoreConfig = getEnvConfig();

  constructor(
    @inject(TYPES.ArtifactBuilderOptions) options: ArtifactBuilderOptions,
    @inject(TYPES.ExtensionConfig) config: any,
    @inject(TYPES.ExtensionName) moduleName: string
  ) {
    super(config, moduleName);
    this.filePath = options.filePath;
    this.indicatorPathPattern = new RegExp(
      `${this.vulcanFolderPathPattern.source.replace('\\', '')}/indicator.json`
    );
  }

  public async save(data: Buffer): Promise<void> {
    throw new Error(
      'The extension not provide the save method, it only use to load the data from the storage'
    );
  }

  public async load(): Promise<Buffer> {
    const storageService = await createStorageService(this.envConfig.storage);
    this.logger.debug('Canner storage service created');
    const filesInfo = await storageService.listObjects({
      path: this.filePath,
      recursive: true,
    });
    // get the indicator files path of each workspaces
    const files = await this.geIndicatorFilesOfWorkspaces(filesInfo);
    // get the latest artifacts of each workspaces
    const artifacts = await this.getLatestArtifactsOfWorkspaces(
      storageService,
      files
    );
    // merge the artifacts of each workspaces to one artifact
    const artifact = await this.mergeArtifactsOfWorkspaces(artifacts);
    return Buffer.from(JSON.stringify(artifact), 'utf-8');
  }

  private async geIndicatorFilesOfWorkspaces(filesInfo: ObjectBasicInfo[]) {
    const filePaths = chain(filesInfo)
      .filter((fileInfo) => this.indicatorPathPattern.test(fileInfo.name))
      .map((fileInfo) => {
        return {
          name: fileInfo.name,
          workspaceId: this.vulcanFolderPathPattern.exec(fileInfo.name)![1],
        };
      })
      .value();
    this.logger.debug('Succeed to get the indicator files of each workspaces');
    return filePaths;
  }

  private async getLatestArtifactsOfWorkspaces(
    storageService: BaseStorageService,
    indicators: { workspaceId: string; name: string }[]
  ): Promise<WorkspaceArtifact[]> {
    return await Promise.all(
      // download latest artifact buffer content of each workspace by viewing the indicator.json of the each workspace
      indicators.map(async ({ workspaceId, name }) => {
        const buffer = await storageService.downObjectAsBuffer({ name });
        const indicator = JSON.parse(
          buffer.toString('utf-8')
        ) as ArtifactIndicator;
        const artifact = await this.getWorkspaceArtifact(
          storageService,
          workspaceId,
          indicator
        );
        this.logger.debug('Succeed to download latest artifacts of workspaces');
        return {
          workspaceSqlName: indicator[workspaceId],
          artifact,
        };
      })
    );
  }

  private async getWorkspaceArtifact(
    storageService: BaseStorageService,
    workspaceId: string,
    indicator: ArtifactIndicator
  ): Promise<BuiltInArtifact> {
    const latestArtifactFolder = indicator[indicator.master];
    const path = `${workspaceId}/vulcansql/${latestArtifactFolder}/result.json`;
    // download from artifact path name
    const buffer = await storageService.downObjectAsBuffer({
      name: path,
    });
    // parse the artifact buffer content to object
    return JSON.parse(buffer.toString('utf-8')) as BuiltInArtifact;
  }

  private async mergeArtifactsOfWorkspaces(
    artifacts: WorkspaceArtifact[]
  ): Promise<BuiltInArtifact> {
    const merged = artifacts.reduce(
      (merged, { workspaceSqlName, artifact }) => {
        // Template
        Object.entries(artifact.templates).forEach(([sourceName, value]) => {
          // add the workspace sql name prefix to original source name
          const workspaceSourceName = `${workspaceSqlName}/${sourceName}`;
          merged.templates[workspaceSourceName] = value;
        });
        // API Schemas
        artifact.schemas.forEach((schema) => {
          // concat the workspace sql name prefix to urlPath, urlPath has the "/" prefix, so concat directly
          schema.urlPath = `${workspaceSqlName}${schema.urlPath}`;
          // concat the workspace sql name prefix to template source, so it could find the "sourceName" in templates
          schema.templateSource = `${workspaceSqlName}/${schema.templateSource}`;
          // normalize the schema profiles to the same for canner enterprise integration used
          schema.profiles = this.envConfig.profiles;
          merged.schemas.push(schema);
        });
        // Specs, only support the oas3 specification for canner enterprise integration used
        if (!artifact.specs['oas3'])
          throw new Error(
            `The workspace sql name "${workspaceSqlName}" artifact not use "oas3" specification, canner persistence store only support the "oas3" specification`
          );
        if (artifact.specs['oas3']['paths'])
          Object.entries(artifact.specs['oas3']['paths']).forEach(
            ([apiEndpoint, endpointInfo]) => {
              // concat the workspace sql name prefix to original api endpoint
              // ths api endpoint has the "/" prefix, so concat directly
              const endpoint = `${workspaceSqlName}${apiEndpoint}`;
              merged.specs['oas3']['paths'][endpoint] =
                endpointInfo as oas3.PathItemObject;
            }
          );
        return merged;
      },
      {
        templates: {},
        schemas: [],
        specs: { oas3: { paths: {} } },
      } as RawBuiltInArtifact
    );
    // assign the openapi version and info to the merged artifact
    merged.specs['oas3'] = {
      ...merged.specs['oas3'],
      // Follow the OpenAPI specification version 3.0.3
      // see https://github.com/OAI/OpenAPI-Specification/blob/main/versions/3.0.3.md
      openapi: '3.0.3',
      info: {
        title: 'Data API',
        version: 'latest',
        description: 'Data API for Canner Enterprise',
      },
    };
    return merged as BuiltInArtifact;
  }
}
