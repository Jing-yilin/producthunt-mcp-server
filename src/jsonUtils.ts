import * as fs from 'fs';
import * as path from 'path';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * Configuration for JSON response handling
 */
export interface JsonResponseConfig {
  maxItemsForContext: number;
}

/**
 * Options for formatting responses
 */
export interface FormatResponseOptions {
  rawDataSaveDir?: string;
  toolName?: string;
  params?: Record<string, any>;
}

/**
 * Result from finding a large array field
 */
interface LargeArrayFieldResult {
  fieldPath: string;
  array: any[];
  parentObj: any;
  fieldKey: string;
}

/**
 * Result from limiting items in a response
 */
interface LimitItemsResult {
  limited: any;
  originalCount: number;
  wasLimited: boolean;
  limitedField: string | null;
}

/**
 * Result from saving raw data
 */
interface SaveRawDataResult {
  filePath: string;
  fileSize: number;
}

/**
 * Utility class for handling JSON data in MCP responses
 */
export class JsonResponseHandler {
  private config: JsonResponseConfig;

  constructor(config: JsonResponseConfig) {
    this.config = config;
  }

  /**
   * Save raw data to a file
   */
  saveRawData(data: any, saveDir: string, toolName: string, params?: Record<string, any>): SaveRawDataResult {
    // Ensure directory exists
    if (!fs.existsSync(saveDir)) {
      fs.mkdirSync(saveDir, { recursive: true });
    }

    // Generate filename with timestamp and params
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    // Build params string for filename (exclude raw_data_save_dir)
    let paramsStr = '';
    if (params) {
      const relevantParams = Object.entries(params)
        .filter(([key, value]) => key !== 'raw_data_save_dir' && value !== undefined && value !== null)
        .map(([key, value]) => `${key}=${String(value).substring(0, 30)}`) // Limit value length
        .join('_');
      if (relevantParams) {
        // Sanitize for filename (remove/replace invalid chars)
        paramsStr = '_' + relevantParams.replace(/[^a-zA-Z0-9_=-]/g, '-');
      }
    }

    const filename = `${toolName}${paramsStr}_${timestamp}.json`;
    const filePath = path.join(saveDir, filename);

    // Write data to file
    const content = JSON.stringify(data, null, 2);
    fs.writeFileSync(filePath, content, 'utf-8');

    // Get file size
    const stats = fs.statSync(filePath);

    return { filePath, fileSize: stats.size };
  }

  /**
   * Format file size to human readable string
   */
  formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /**
   * Find the first array field in the data that has more than maxItemsForContext items
   * Returns the field path and the array
   */
  findLargeArrayField(data: any, pathStr: string = ''): LargeArrayFieldResult | null {
    if (!data || typeof data !== 'object') return null;

    // If data itself is an array with >maxItems items
    if (Array.isArray(data)) {
      if (data.length > this.config.maxItemsForContext) {
        return { fieldPath: pathStr || '(root)', array: data, parentObj: null, fieldKey: '' };
      }
      return null;
    }

    // Search through object properties
    for (const key of Object.keys(data)) {
      const value = data[key];
      const currentPath = pathStr ? `${pathStr}.${key}` : key;

      // Check if this field is an array with >maxItems items
      if (Array.isArray(value) && value.length > this.config.maxItemsForContext) {
        return { fieldPath: currentPath, array: value, parentObj: data, fieldKey: key };
      }

      // Recursively search nested objects (but not arrays)
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const found = this.findLargeArrayField(value, currentPath);
        if (found) return found;
      }
    }

    return null;
  }

  /**
   * Limit items in the response to maxItemsForContext
   * Dynamically finds which field contains >maxItems items and limits that field
   * Returns the limited data, the original count, field path, and whether it was limited
   */
  limitItems(data: any): LimitItemsResult {
    if (!data) return { limited: data, originalCount: 0, wasLimited: false, limitedField: null };

    // Find the first array field with >maxItems items
    const largeArrayInfo = this.findLargeArrayField(data);

    if (!largeArrayInfo) {
      // No large arrays found
      return { limited: data, originalCount: 0, wasLimited: false, limitedField: null };
    }

    const { fieldPath, array, parentObj } = largeArrayInfo;
    const originalCount = array.length;

    // If root is the array
    if (parentObj === null) {
      return {
        limited: data.slice(0, this.config.maxItemsForContext),
        originalCount,
        wasLimited: true,
        limitedField: fieldPath,
      };
    }

    // Deep clone the data and limit the specific field
    const limitedData = JSON.parse(JSON.stringify(data));

    // Navigate to the parent and set the limited array
    const pathParts = fieldPath.split('.');
    let target = limitedData;
    for (let i = 0; i < pathParts.length - 1; i++) {
      target = target[pathParts[i]];
    }
    const lastKey = pathParts[pathParts.length - 1];
    target[lastKey] = array.slice(0, this.config.maxItemsForContext);

    return {
      limited: limitedData,
      originalCount,
      wasLimited: true,
      limitedField: fieldPath,
    };
  }

  /**
   * Generate a tree representation of JSON structure
   */
  generateJsonStructureTree(obj: any, prefix: string = '', isLast: boolean = true): string {
    const lines: string[] = [];

    if (obj === null || obj === undefined) {
      return 'null';
    }

    if (Array.isArray(obj)) {
      if (obj.length === 0) {
        return '[]';
      }
      // Show structure of first item
      lines.push('Array[' + obj.length + ']');
      const firstItem = obj[0];
      if (firstItem && typeof firstItem === 'object') {
        const childPrefix = prefix + (isLast ? '    ' : '│   ');
        lines.push(prefix + '└── [0]: ' + this.generateJsonStructureTree(firstItem, childPrefix, true));
      } else {
        lines.push(prefix + '└── [0]: ' + typeof firstItem);
      }
      return lines.join('\n');
    }

    if (typeof obj === 'object') {
      const keys = Object.keys(obj);
      if (keys.length === 0) {
        return '{}';
      }

      keys.forEach((key, index) => {
        const isLastKey = index === keys.length - 1;
        const connector = isLastKey ? '└── ' : '├── ';
        const childPrefix = prefix + (isLastKey ? '    ' : '│   ');
        const value = obj[key];

        if (value === null || value === undefined) {
          lines.push(prefix + connector + key + ': null');
        } else if (Array.isArray(value)) {
          if (value.length === 0) {
            lines.push(prefix + connector + key + ': []');
          } else if (typeof value[0] === 'object') {
            lines.push(prefix + connector + key + ': Array[' + value.length + ']');
            lines.push(childPrefix + '└── [item]:');
            const itemTree = this.generateJsonStructureTree(value[0], childPrefix + '    ', true);
            lines.push(itemTree.split('\n').map(l => childPrefix + '    ' + l).join('\n'));
          } else {
            lines.push(prefix + connector + key + ': Array[' + value.length + '] of ' + typeof value[0]);
          }
        } else if (typeof value === 'object') {
          lines.push(prefix + connector + key + ':');
          const childTree = this.generateJsonStructureTree(value, childPrefix, true);
          lines.push(childTree);
        } else {
          lines.push(prefix + connector + key + ': ' + typeof value);
        }
      });

      return lines.join('\n');
    }

    return typeof obj;
  }

  /**
   * Format response as markdown for better agent readability
   */
  formatResponse(data: any, options?: FormatResponseOptions): CallToolResult {
    let savedFileInfo: SaveRawDataResult | undefined;

    // Save raw data if directory is specified (always save full data)
    if (options?.rawDataSaveDir) {
      savedFileInfo = this.saveRawData(data, options.rawDataSaveDir, options.toolName || 'response', options.params);
    }

    // Limit items for agent context (dynamically finds which field has >maxItems items)
    const { limited, originalCount, wasLimited, limitedField } = this.limitItems(data);

    // Build markdown response
    const lines: string[] = [];

    // Header with metadata
    lines.push(`## ${options?.toolName || 'Response'}`);
    lines.push('');

    if (savedFileInfo) {
      lines.push(`> **Raw data saved to**: \`${savedFileInfo.filePath}\` (${this.formatFileSize(savedFileInfo.fileSize)})`);
      lines.push('');
    }

    // Show limitation info if items were limited
    if (wasLimited && limitedField) {
      lines.push(`> **Note**: \`${limitedField}\` limited to ${this.config.maxItemsForContext} items (${originalCount} total). ${savedFileInfo ? 'Full data saved to file.' : 'Provide `raw_data_save_dir` parameter to save full response.'}`);
      lines.push('');
    }

    // Show JSON structure tree
    lines.push('### JSON Structure');
    lines.push('```');
    lines.push(this.generateJsonStructureTree(limited));
    lines.push('```');
    lines.push('');

    // Show data section header with item count info
    if (wasLimited) {
      lines.push(`### Data (\`${limitedField}\`: ${this.config.maxItemsForContext}/${originalCount} items)`);
    } else {
      lines.push('### Data');
    }
    lines.push('```json');
    lines.push(JSON.stringify(limited, null, 2));
    lines.push('```');

    return {
      content: [
        {
          type: 'text',
          text: lines.join('\n'),
        },
      ],
    };
  }
}
