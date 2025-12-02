import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { JsonResponseHandler } from '../jsonUtils';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('JsonResponseHandler', () => {
  let handler: JsonResponseHandler;
  let tempDir: string;

  beforeEach(() => {
    handler = new JsonResponseHandler({ maxItemsForContext: 10 });
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-utils-test-'));
  });

  afterEach(() => {
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  describe('formatFileSize', () => {
    test('formats bytes correctly', () => {
      expect(handler.formatFileSize(500)).toBe('500 B');
    });

    test('formats kilobytes correctly', () => {
      expect(handler.formatFileSize(1024)).toBe('1.0 KB');
      expect(handler.formatFileSize(2560)).toBe('2.5 KB');
    });

    test('formats megabytes correctly', () => {
      expect(handler.formatFileSize(1024 * 1024)).toBe('1.0 MB');
      expect(handler.formatFileSize(2.5 * 1024 * 1024)).toBe('2.5 MB');
    });
  });

  describe('findLargeArrayField', () => {
    test('returns null for null/undefined data', () => {
      expect(handler.findLargeArrayField(null)).toBeNull();
      expect(handler.findLargeArrayField(undefined)).toBeNull();
    });

    test('returns null for primitive data', () => {
      expect(handler.findLargeArrayField('string')).toBeNull();
      expect(handler.findLargeArrayField(123)).toBeNull();
    });

    test('returns null for empty array', () => {
      expect(handler.findLargeArrayField([])).toBeNull();
    });

    test('returns null for small array (<= 10 items)', () => {
      const smallArray = Array(10).fill({ id: 1 });
      expect(handler.findLargeArrayField(smallArray)).toBeNull();
    });

    test('detects large root array (> 10 items)', () => {
      const largeArray = Array(15).fill({ id: 1 });
      const result = handler.findLargeArrayField(largeArray);

      expect(result).not.toBeNull();
      expect(result!.fieldPath).toBe('(root)');
      expect(result!.array.length).toBe(15);
      expect(result!.parentObj).toBeNull();
    });

    test('detects large edges array in GraphQL response', () => {
      const graphqlResponse = {
        edges: Array(15).fill({ node: { id: '1', name: 'Test' } }),
        pageInfo: { hasNextPage: true }
      };

      const result = handler.findLargeArrayField(graphqlResponse);

      expect(result).not.toBeNull();
      expect(result!.fieldPath).toBe('edges');
      expect(result!.array.length).toBe(15);
    });

    test('detects large array in nested object', () => {
      const nestedData = {
        meta: { total: 20 },
        data: {
          items: Array(12).fill({ id: 1 })
        }
      };

      const result = handler.findLargeArrayField(nestedData);

      expect(result).not.toBeNull();
      expect(result!.fieldPath).toBe('data.items');
      expect(result!.array.length).toBe(12);
    });

    test('returns first large array found (breadth-first)', () => {
      const multiArrayData = {
        smallArray: Array(5).fill({ id: 1 }),
        largeArray1: Array(15).fill({ id: 2 }),
        nested: {
          largeArray2: Array(20).fill({ id: 3 })
        }
      };

      const result = handler.findLargeArrayField(multiArrayData);

      expect(result).not.toBeNull();
      expect(result!.fieldPath).toBe('largeArray1');
    });

    test('handles deeply nested arrays', () => {
      const deeplyNested = {
        level1: {
          level2: {
            level3: {
              items: Array(11).fill({ id: 1 })
            }
          }
        }
      };

      const result = handler.findLargeArrayField(deeplyNested);

      expect(result).not.toBeNull();
      expect(result!.fieldPath).toBe('level1.level2.level3.items');
    });
  });

  describe('limitItems', () => {
    test('returns unchanged data for null/undefined', () => {
      const result = handler.limitItems(null);

      expect(result.limited).toBeNull();
      expect(result.wasLimited).toBe(false);
      expect(result.limitedField).toBeNull();
    });

    test('returns unchanged data for small arrays', () => {
      const smallArray = Array(5).fill({ id: 1 });
      const result = handler.limitItems(smallArray);

      expect(result.limited).toEqual(smallArray);
      expect(result.wasLimited).toBe(false);
      expect(result.limitedField).toBeNull();
    });

    test('limits root array to max items', () => {
      const largeArray = Array(15).fill(null).map((_, i) => ({ id: i }));
      const result = handler.limitItems(largeArray);

      expect(result.limited.length).toBe(10);
      expect(result.originalCount).toBe(15);
      expect(result.wasLimited).toBe(true);
      expect(result.limitedField).toBe('(root)');
    });

    test('limits nested edges array', () => {
      const graphqlResponse = {
        edges: Array(20).fill(null).map((_, i) => ({ node: { id: i } })),
        pageInfo: { hasNextPage: true, endCursor: 'abc' }
      };

      const result = handler.limitItems(graphqlResponse);

      expect(result.limited.edges.length).toBe(10);
      expect(result.limited.pageInfo).toEqual({ hasNextPage: true, endCursor: 'abc' });
      expect(result.originalCount).toBe(20);
      expect(result.wasLimited).toBe(true);
      expect(result.limitedField).toBe('edges');
    });

    test('limits deeply nested array without modifying other fields', () => {
      const data = {
        meta: { total: 12, page: 1 },
        response: {
          items: Array(12).fill(null).map((_, i) => ({ id: i })),
          status: 'success'
        }
      };

      const result = handler.limitItems(data);

      expect(result.limited.response.items.length).toBe(10);
      expect(result.limited.response.status).toBe('success');
      expect(result.limited.meta).toEqual({ total: 12, page: 1 });
      expect(result.originalCount).toBe(12);
      expect(result.limitedField).toBe('response.items');
    });

    test('does not mutate original data', () => {
      const original = {
        edges: Array(15).fill({ node: { id: 1 } })
      };
      const originalLength = original.edges.length;

      handler.limitItems(original);

      expect(original.edges.length).toBe(originalLength);
    });
  });

  describe('generateJsonStructureTree', () => {
    test('handles null/undefined', () => {
      expect(handler.generateJsonStructureTree(null)).toBe('null');
      expect(handler.generateJsonStructureTree(undefined)).toBe('null');
    });

    test('handles empty array', () => {
      expect(handler.generateJsonStructureTree([])).toBe('[]');
    });

    test('handles empty object', () => {
      expect(handler.generateJsonStructureTree({})).toBe('{}');
    });

    test('handles primitive array', () => {
      const result = handler.generateJsonStructureTree([1, 2, 3]);
      expect(result).toContain('Array[3]');
      expect(result).toContain('[0]: number');
    });

    test('handles object array', () => {
      const data = [{ id: 1, name: 'test' }];
      const result = handler.generateJsonStructureTree(data);

      expect(result).toContain('Array[1]');
      expect(result).toContain('id: number');
      expect(result).toContain('name: string');
    });

    test('handles nested object structure', () => {
      const data = {
        user: {
          id: 1,
          profile: {
            name: 'test'
          }
        },
        active: true
      };

      const result = handler.generateJsonStructureTree(data);

      expect(result).toContain('user:');
      expect(result).toContain('id: number');
      expect(result).toContain('profile:');
      expect(result).toContain('name: string');
      expect(result).toContain('active: boolean');
    });

    test('shows array length in structure', () => {
      const data = {
        items: Array(5).fill({ id: 1 })
      };

      const result = handler.generateJsonStructureTree(data);

      expect(result).toContain('items: Array[5]');
    });
  });

  describe('saveRawData', () => {
    test('creates directory if not exists', () => {
      const newDir = path.join(tempDir, 'subdir');
      const data = { test: true };

      handler.saveRawData(data, newDir, 'test_tool');

      expect(fs.existsSync(newDir)).toBe(true);
    });

    test('saves data to file with correct content', () => {
      const data = { id: 1, name: 'test' };
      const result = handler.saveRawData(data, tempDir, 'test_tool');

      const savedContent = fs.readFileSync(result.filePath, 'utf-8');
      expect(JSON.parse(savedContent)).toEqual(data);
    });

    test('includes params in filename', () => {
      const data = { test: true };
      const result = handler.saveRawData(data, tempDir, 'get_posts', { featured: true, first: 10 });

      expect(result.filePath).toContain('get_posts');
      expect(result.filePath).toContain('featured=true');
      expect(result.filePath).toContain('first=10');
    });

    test('excludes raw_data_save_dir from filename', () => {
      const data = { test: true };
      const result = handler.saveRawData(data, tempDir, 'test_tool', {
        featured: true,
        raw_data_save_dir: '/some/path'
      });

      expect(result.filePath).not.toContain('raw_data_save_dir');
    });

    test('returns correct file size', () => {
      const data = { id: 1, name: 'test', nested: { value: 123 } };
      const result = handler.saveRawData(data, tempDir, 'test_tool');

      const stats = fs.statSync(result.filePath);
      expect(result.fileSize).toBe(stats.size);
    });

    test('sanitizes special characters in params for filename', () => {
      const data = { test: true };
      const result = handler.saveRawData(data, tempDir, 'test_tool', {
        query: 'test/path:value'
      });

      // Should not contain filesystem-invalid characters
      const filename = path.basename(result.filePath);
      expect(filename).not.toContain('/');
      expect(filename).not.toContain(':');
    });
  });

  describe('formatResponse', () => {
    test('returns CallToolResult structure', () => {
      const data = { id: 1 };
      const result = handler.formatResponse(data);

      expect(result).toHaveProperty('content');
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content[0]).toHaveProperty('type', 'text');
      expect(result.content[0]).toHaveProperty('text');
    });

    test('includes tool name in header', () => {
      const data = { id: 1 };
      const result = handler.formatResponse(data, { toolName: 'get_posts' });

      expect(result.content[0].text).toContain('## get_posts');
    });

    test('includes JSON structure tree', () => {
      const data = { id: 1, name: 'test' };
      const result = handler.formatResponse(data);

      expect(result.content[0].text).toContain('### JSON Structure');
      expect(result.content[0].text).toContain('id: number');
      expect(result.content[0].text).toContain('name: string');
    });

    test('includes JSON data section', () => {
      const data = { id: 1 };
      const result = handler.formatResponse(data);

      expect(result.content[0].text).toContain('### Data');
      expect(result.content[0].text).toContain('```json');
      expect(result.content[0].text).toContain('"id": 1');
    });

    test('saves raw data when rawDataSaveDir is provided', () => {
      const data = { id: 1 };
      const result = handler.formatResponse(data, {
        rawDataSaveDir: tempDir,
        toolName: 'test_tool'
      });

      expect(result.content[0].text).toContain('Raw data saved to');
      expect(result.content[0].text).toContain(tempDir);
    });

    test('shows limitation note when items are limited', () => {
      const largeData = {
        edges: Array(15).fill({ node: { id: 1 } })
      };

      const result = handler.formatResponse(largeData);

      expect(result.content[0].text).toContain('`edges` limited to 10 items (15 total)');
      expect(result.content[0].text).toContain('### Data (`edges`: 10/15 items)');
    });

    test('shows correct field path for nested limited arrays', () => {
      const nestedData = {
        response: {
          items: Array(12).fill({ id: 1 })
        }
      };

      const result = handler.formatResponse(nestedData);

      expect(result.content[0].text).toContain('`response.items` limited to 10 items');
    });

    test('includes file size in output', () => {
      const data = { id: 1, name: 'test' };
      const result = handler.formatResponse(data, {
        rawDataSaveDir: tempDir,
        toolName: 'test_tool'
      });

      // Should contain file size like "123 B" or "1.2 KB"
      expect(result.content[0].text).toMatch(/\(\d+(\.\d+)?\s*(B|KB|MB)\)/);
    });
  });

  describe('custom maxItemsForContext', () => {
    test('respects custom max items limit', () => {
      const customHandler = new JsonResponseHandler({ maxItemsForContext: 5 });
      const data = Array(10).fill({ id: 1 });

      const result = customHandler.limitItems(data);

      expect(result.limited.length).toBe(5);
      expect(result.wasLimited).toBe(true);
    });

    test('does not limit when under custom threshold', () => {
      const customHandler = new JsonResponseHandler({ maxItemsForContext: 20 });
      const data = Array(15).fill({ id: 1 });

      const result = customHandler.limitItems(data);

      expect(result.limited.length).toBe(15);
      expect(result.wasLimited).toBe(false);
    });
  });
});
