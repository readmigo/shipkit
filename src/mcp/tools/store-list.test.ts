import { describe, it, expect, vi } from 'vitest';

// We test the handler logic by calling registerStoreListTool with a mock server
// and then invoking the captured handler.

describe('store-list tool', () => {
  it('should register a tool named store.list on the server', async () => {
    const { registerStoreListTool } = await import('./store-list.js');

    const mockServer = {
      registerTool: vi.fn(),
    };

    registerStoreListTool(mockServer as any);

    expect(mockServer.registerTool).toHaveBeenCalledTimes(1);
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      'store.list',
      expect.objectContaining({
        title: 'List Supported Stores',
      }),
      expect.any(Function),
    );
  });

  it('should return all stores when no platform filter is provided', async () => {
    const { registerStoreListTool } = await import('./store-list.js');

    let capturedHandler: Function | undefined;
    const mockServer = {
      registerTool: vi.fn((_name: string, _opts: any, handler: Function) => {
        capturedHandler = handler;
      }),
    };

    registerStoreListTool(mockServer as any);
    expect(capturedHandler).toBeDefined();

    const result = await capturedHandler!({ platform: undefined });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.stores).toBeInstanceOf(Array);
    expect(parsed.stores.length).toBe(8);

    const storeIds = parsed.stores.map((s: any) => s.store_id);
    expect(storeIds).toContain('google_play');
    expect(storeIds).toContain('app_store');
    expect(storeIds).toContain('huawei_agc');
    expect(storeIds).toContain('xiaomi');
    expect(storeIds).toContain('pgyer');
  });

  it('should filter stores by platform=ios', async () => {
    const { registerStoreListTool } = await import('./store-list.js');

    let capturedHandler: Function | undefined;
    const mockServer = {
      registerTool: vi.fn((_name: string, _opts: any, handler: Function) => {
        capturedHandler = handler;
      }),
    };

    registerStoreListTool(mockServer as any);
    const result = await capturedHandler!({ platform: 'ios' });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.stores.length).toBe(1);
    expect(parsed.stores[0].store_id).toBe('app_store');
    expect(parsed.stores[0].platform).toBe('ios');
  });

  it('should filter stores by platform=android', async () => {
    const { registerStoreListTool } = await import('./store-list.js');

    let capturedHandler: Function | undefined;
    const mockServer = {
      registerTool: vi.fn((_name: string, _opts: any, handler: Function) => {
        capturedHandler = handler;
      }),
    };

    registerStoreListTool(mockServer as any);
    const result = await capturedHandler!({ platform: 'android' });
    const parsed = JSON.parse(result.content[0].text);

    // google_play, huawei_agc, xiaomi, oppo, vivo, honor, pgyer = 7
    expect(parsed.stores.length).toBe(7);
    parsed.stores.forEach((s: any) => {
      expect(s.platform).toBe('android');
    });
  });

  it('should return correct fields in store objects', async () => {
    const { registerStoreListTool } = await import('./store-list.js');

    let capturedHandler: Function | undefined;
    const mockServer = {
      registerTool: vi.fn((_name: string, _opts: any, handler: Function) => {
        capturedHandler = handler;
      }),
    };

    registerStoreListTool(mockServer as any);
    const result = await capturedHandler!({ platform: undefined });
    const parsed = JSON.parse(result.content[0].text);

    const store = parsed.stores[0];
    expect(store).toHaveProperty('store_id');
    expect(store).toHaveProperty('name');
    expect(store).toHaveProperty('platform');
    expect(store).toHaveProperty('region');
    expect(store).toHaveProperty('auth_status');
    expect(store).toHaveProperty('supported_file_types');
    expect(store).toHaveProperty('features');
  });

  it('should return empty array for platform with no stores', async () => {
    const { registerStoreListTool } = await import('./store-list.js');

    let capturedHandler: Function | undefined;
    const mockServer = {
      registerTool: vi.fn((_name: string, _opts: any, handler: Function) => {
        capturedHandler = handler;
      }),
    };

    registerStoreListTool(mockServer as any);
    const result = await capturedHandler!({ platform: 'harmonyos' });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.stores).toEqual([]);
  });
});
