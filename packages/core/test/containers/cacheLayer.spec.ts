import {
  CacheLayerLoader,
  cacheLayerModule,
  CacheLayerProviderType,
  cacheProfileName,
  DataResult,
  DataSource,
  dataSourceModule,
  FileCacheLayerProvider,
  Profile,
  TYPES,
  VulcanExtensionId,
} from '@vulcan-sql/core';
import * as sinon from 'ts-sinon';
import { Container, interfaces, multiInject } from 'inversify';
import {
  CacheLayerStoreLoaderType,
  ICacheLayerOptions,
} from '@vulcan-sql/core';

@VulcanExtensionId('duckdb')
class MockDuckDBDataSource extends DataSource {
  @multiInject(TYPES.Profile) public injectedProfiles!: Profile[];
  public execute(): Promise<DataResult> {
    throw new Error('Method not implemented.');
  }

  public prepare(): Promise<string> {
    throw new Error('Method not implemented.');
  }
}

@VulcanExtensionId('pg')
class MockPGDataSource extends DataSource {
  @multiInject(TYPES.Profile) public injectedProfiles!: Profile[];
  public execute(): Promise<DataResult> {
    throw new Error('Method not implemented.');
  }

  public prepare(): Promise<string> {
    throw new Error('Method not implemented.');
  }
}

let container: Container;
let profiles: Map<string, Profile>;

beforeEach(async () => {
  container = new Container();
  container
    .bind(TYPES.Extension_DataSource)
    .to(MockDuckDBDataSource)
    .whenTargetNamed('duckdb');
  container
    .bind(TYPES.Extension_DataSource)
    .to(MockPGDataSource)
    .whenTargetNamed('pg');

  container.bind(TYPES.ExtensionConfig).toConstantValue({});
  container.bind(TYPES.ExtensionName).toConstantValue('');

  // prepare profiles
  profiles = new Map<string, Profile>();
  profiles.set('test-pg', { name: 'test-pg', type: 'pg', allow: '*' });
  profiles.set('test-duck', { name: 'test-duck', type: 'duckdb', allow: '*' });
});

it('Cache layer module should bind "cache-layer" profile to "duckdb" type data source when caches setting has least one in some schemas', async () => {
  // Arrange
  const stubOptions: ICacheLayerOptions = {
    ...sinon.stubInterface<ICacheLayerOptions>(),
    provider: CacheLayerProviderType.LocalFile,
    loader: CacheLayerStoreLoaderType.DuckDB,
  };
  // load data source module
  await container.loadAsync(dataSourceModule(profiles, stubOptions));
  const factory = container.get<interfaces.Factory<any>>(
    TYPES.Factory_DataSource
  );

  // Act
  const dsFromTestPg = factory('test-pg') as MockPGDataSource;
  const dsFromTestDuck = factory('test-duck') as MockDuckDBDataSource;
  const dsFromCacheLayer = factory(cacheProfileName) as MockDuckDBDataSource;

  // Assert
  expect(dsFromTestPg instanceof MockPGDataSource).toBeTruthy();
  expect(dsFromTestDuck instanceof MockDuckDBDataSource).toBeTruthy();
  expect(dsFromCacheLayer instanceof MockDuckDBDataSource).toBeTruthy();

  expect(dsFromTestDuck.injectedProfiles).toEqual([
    { name: 'test-duck', type: 'duckdb', allow: '*' },
    { name: cacheProfileName, type: 'duckdb', allow: '*' },
  ]);
  expect(dsFromCacheLayer.injectedProfiles).toEqual([
    { name: 'test-duck', type: 'duckdb', allow: '*' },
    { name: cacheProfileName, type: 'duckdb', allow: '*' },
  ]);
});

it('Cache layer loader should be bound to "duckdb" type data source when loader of caches options has set', async () => {
  // Arrange
  const stubOptions: ICacheLayerOptions = {
    ...sinon.stubInterface<ICacheLayerOptions>(),
    provider: CacheLayerProviderType.LocalFile,
    loader: CacheLayerStoreLoaderType.DuckDB,
  };
  container
    .bind(TYPES.Extension_CacheLayerProvider)
    .to(FileCacheLayerProvider)
    .whenTargetNamed(CacheLayerProviderType.LocalFile);
  // load data source module & cache layer options
  await container.loadAsync(dataSourceModule(profiles, stubOptions));
  await container.loadAsync(cacheLayerModule(stubOptions));

  // Act, Assert
  expect(() =>
    container.get<CacheLayerLoader>(TYPES.CacheLayerLoader)
  ).not.toThrow();
});
