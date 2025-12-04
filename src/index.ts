#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  CallToolResult,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js';
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { encode } from '@toon-format/toon';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Data cleaners for Product Hunt entities
 * Removes noise and keeps only useful fields for agents
 */
const DataCleaners = {
  cleanPost(raw: any): any {
    if (!raw) return null;
    return {
      id: raw.id,
      slug: raw.slug,
      name: raw.name,
      tagline: raw.tagline,
      description: raw.description?.substring(0, 300),
      url: raw.url,
      website: raw.website,
      votes: raw.votesCount,
      comments: raw.commentsCount,
      rating: raw.reviewsRating,
      featuredAt: raw.featuredAt,
      createdAt: raw.createdAt,
      thumbnail: raw.thumbnail?.url,
      topics: raw.topics?.edges?.map((e: any) => e.node?.name).filter(Boolean) || [],
      makers: raw.makers?.filter((m: any) => m.name !== '[REDACTED]').map((m: any) => m.name) || [],
      hunter: raw.user?.name,
    };
  },

  cleanPostListItem(raw: any): any {
    if (!raw) return null;
    return {
      id: raw.id,
      slug: raw.slug,
      name: raw.name,
      tagline: raw.tagline,
      votes: raw.votesCount,
      comments: raw.commentsCount,
      featuredAt: raw.featuredAt,
      topics: raw.topics?.edges?.slice(0, 3).map((e: any) => e.node?.name).filter(Boolean) || [],
    };
  },

  cleanCollection(raw: any): any {
    if (!raw) return null;
    return {
      id: raw.id,
      name: raw.name,
      description: raw.description?.substring(0, 200),
      followers: raw.followersCount,
      postsCount: raw.postsCount || raw.posts?.totalCount,
      createdAt: raw.createdAt,
      curator: raw.user?.name,
    };
  },

  cleanUser(raw: any): any {
    if (!raw) return null;
    return {
      id: raw.id,
      username: raw.username,
      name: raw.name,
      headline: raw.headline,
      profileImage: raw.profileImage,
      website: raw.websiteUrl,
      twitter: raw.twitterUsername,
      followers: raw.followersCount,
      following: raw.followingCount,
      isMaker: raw.isMaker,
      madePostsCount: raw.madePosts?.totalCount,
      votedPostsCount: raw.votedPosts?.totalCount,
    };
  },

  cleanTopic(raw: any): any {
    if (!raw) return null;
    return {
      id: raw.id,
      slug: raw.slug,
      name: raw.name,
      description: raw.description?.substring(0, 150),
      followers: raw.followersCount,
      posts: raw.postsCount,
    };
  },

  cleanComment(raw: any): any {
    if (!raw) return null;
    return {
      id: raw.id,
      body: raw.body?.substring(0, 300),
      votes: raw.votesCount,
      createdAt: raw.createdAt,
      author: raw.user?.name,
      repliesCount: raw.replies?.totalCount,
    };
  },

  cleanGoal(raw: any): any {
    if (!raw) return null;
    return {
      id: raw.id,
      title: raw.title,
      dueAt: raw.dueAt,
      isCompleted: raw.isCompleted,
      completedAt: raw.completedAt,
      cheers: raw.cheersCount,
      user: raw.user?.name,
      group: raw.makerGroup?.name,
      project: raw.project?.name,
    };
  },

  cleanMakerGroup(raw: any): any {
    if (!raw) return null;
    return {
      id: raw.id,
      name: raw.name,
      tagline: raw.tagline,
      description: raw.description?.substring(0, 150),
      members: raw.membersCount,
      goals: raw.goalsCount,
      createdAt: raw.createdAt,
    };
  },
};

interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor?: string;
  endCursor?: string;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

/**
 * Product Hunt API MCP Server
 * Returns cleaned data in TOON format for token efficiency
 */
class ProductHuntAPIMCPServer {
  private server: Server;
  private apiClient: AxiosInstance;
  private accessToken: string;

  constructor() {
    this.accessToken = process.env.PRODUCTHUNT_ACCESS_TOKEN || process.env.PH_ACCESS_TOKEN || '';

    this.server = new Server(
      { name: 'producthunt-mcp-server', version: '1.2.0' },
      { capabilities: { tools: {} } }
    );

    const axiosConfig: AxiosRequestConfig = {
      baseURL: 'https://api.producthunt.com/v2/api',
      timeout: 30000,
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'ProductHunt-MCP-Server/1.2.0' }
    };

    const proxyUrl = process.env.PROXY_URL || process.env.HTTP_PROXY || process.env.HTTPS_PROXY;
    if (proxyUrl) {
      axiosConfig.httpsAgent = new HttpsProxyAgent(proxyUrl);
      axiosConfig.proxy = false;
    }

    this.apiClient = axios.create(axiosConfig);
    this.setupToolHandlers();
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'get_post',
          description: 'Get a Product Hunt post by ID or slug. Returns cleaned data in TOON format.',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Post ID' },
              slug: { type: 'string', description: 'Post slug' },
              save_dir: { type: 'string', description: 'Directory to save cleaned JSON data' },
            },
            required: [],
          },
        } as Tool,
        {
          name: 'get_posts',
          description: 'Get Product Hunt posts with filters. Returns cleaned data in TOON format.',
          inputSchema: {
            type: 'object',
            properties: {
              featured: { type: 'boolean', description: 'Filter featured posts only' },
              topic: { type: 'string', description: 'Filter by topic slug' },
              postedAfter: { type: 'string', description: 'Filter after date (ISO 8601)' },
              postedBefore: { type: 'string', description: 'Filter before date (ISO 8601)' },
              order: { type: 'string', description: 'Order: FEATURED_AT, NEWEST, RANKING, VOTES', enum: ['FEATURED_AT', 'NEWEST', 'RANKING', 'VOTES'] },
              first: { type: 'integer', description: 'Number of posts (default: 10, max: 20)', default: 10 },
              after: { type: 'string', description: 'Cursor for pagination' },
              save_dir: { type: 'string', description: 'Directory to save cleaned JSON data' },
              max_items: { type: 'integer', description: 'Max items to return (default: 10)', default: 10 },
            },
            required: [],
          },
        } as Tool,
        {
          name: 'search_posts',
          description: 'Search Product Hunt posts. Returns cleaned data in TOON format.',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
              first: { type: 'integer', description: 'Number of posts (default: 10)', default: 10 },
              after: { type: 'string', description: 'Cursor for pagination' },
              save_dir: { type: 'string', description: 'Directory to save cleaned JSON data' },
              max_items: { type: 'integer', description: 'Max items to return (default: 10)', default: 10 },
            },
            required: ['query'],
          },
        } as Tool,
        {
          name: 'get_collection',
          description: 'Get a Product Hunt collection by ID. Returns cleaned data in TOON format.',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Collection ID' },
              save_dir: { type: 'string', description: 'Directory to save cleaned JSON data' },
            },
            required: ['id'],
          },
        } as Tool,
        {
          name: 'get_collections',
          description: 'Get Product Hunt collections. Returns cleaned data in TOON format.',
          inputSchema: {
            type: 'object',
            properties: {
              featured: { type: 'boolean', description: 'Filter featured only' },
              userId: { type: 'string', description: 'Filter by user ID' },
              postId: { type: 'string', description: 'Filter by post ID' },
              order: { type: 'string', description: 'Order: FEATURED_AT, FOLLOWERS_COUNT, NEWEST', enum: ['FEATURED_AT', 'FOLLOWERS_COUNT', 'NEWEST'] },
              first: { type: 'integer', description: 'Number to return (default: 10)', default: 10 },
              after: { type: 'string', description: 'Cursor for pagination' },
              save_dir: { type: 'string', description: 'Directory to save cleaned JSON data' },
              max_items: { type: 'integer', description: 'Max items (default: 10)', default: 10 },
            },
            required: [],
          },
        } as Tool,
        {
          name: 'get_user',
          description: 'Get a Product Hunt user by ID or username. Returns cleaned data in TOON format.',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'User ID' },
              username: { type: 'string', description: 'Username' },
              save_dir: { type: 'string', description: 'Directory to save cleaned JSON data' },
            },
            required: [],
          },
        } as Tool,
        {
          name: 'get_user_posts',
          description: 'Get posts made by a user. Returns cleaned data in TOON format.',
          inputSchema: {
            type: 'object',
            properties: {
              username: { type: 'string', description: 'Username' },
              first: { type: 'integer', description: 'Number of posts (default: 10)', default: 10 },
              after: { type: 'string', description: 'Cursor for pagination' },
              save_dir: { type: 'string', description: 'Directory to save cleaned JSON data' },
              max_items: { type: 'integer', description: 'Max items (default: 10)', default: 10 },
            },
            required: ['username'],
          },
        } as Tool,
        {
          name: 'get_user_voted_posts',
          description: 'Get posts upvoted by a user. Returns cleaned data in TOON format.',
          inputSchema: {
            type: 'object',
            properties: {
              username: { type: 'string', description: 'Username' },
              first: { type: 'integer', description: 'Number of posts (default: 10)', default: 10 },
              after: { type: 'string', description: 'Cursor for pagination' },
              save_dir: { type: 'string', description: 'Directory to save cleaned JSON data' },
              max_items: { type: 'integer', description: 'Max items (default: 10)', default: 10 },
            },
            required: ['username'],
          },
        } as Tool,
        {
          name: 'get_topic',
          description: 'Get a Product Hunt topic by ID or slug. Returns cleaned data in TOON format.',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Topic ID' },
              slug: { type: 'string', description: 'Topic slug' },
              save_dir: { type: 'string', description: 'Directory to save cleaned JSON data' },
            },
            required: [],
          },
        } as Tool,
        {
          name: 'get_topics',
          description: 'Get Product Hunt topics. Returns cleaned data in TOON format.',
          inputSchema: {
            type: 'object',
            properties: {
              search: { type: 'string', description: 'Search query' },
              order: { type: 'string', description: 'Order: FOLLOWERS_COUNT, NEWEST, POSTS_COUNT', enum: ['FOLLOWERS_COUNT', 'NEWEST', 'POSTS_COUNT'] },
              first: { type: 'integer', description: 'Number to return (default: 10)', default: 10 },
              after: { type: 'string', description: 'Cursor for pagination' },
              save_dir: { type: 'string', description: 'Directory to save cleaned JSON data' },
              max_items: { type: 'integer', description: 'Max items (default: 10)', default: 10 },
            },
            required: [],
          },
        } as Tool,
        {
          name: 'get_comment',
          description: 'Get a comment by ID. Returns cleaned data in TOON format.',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Comment ID' },
              save_dir: { type: 'string', description: 'Directory to save cleaned JSON data' },
            },
            required: ['id'],
          },
        } as Tool,
        {
          name: 'get_post_comments',
          description: 'Get comments on a post. Returns cleaned data in TOON format.',
          inputSchema: {
            type: 'object',
            properties: {
              postId: { type: 'string', description: 'Post ID' },
              postSlug: { type: 'string', description: 'Post slug' },
              order: { type: 'string', description: 'Order: NEWEST, VOTES', enum: ['NEWEST', 'VOTES'] },
              first: { type: 'integer', description: 'Number to return (default: 10)', default: 10 },
              after: { type: 'string', description: 'Cursor for pagination' },
              save_dir: { type: 'string', description: 'Directory to save cleaned JSON data' },
              max_items: { type: 'integer', description: 'Max items (default: 10)', default: 10 },
            },
            required: [],
          },
        } as Tool,
        {
          name: 'get_goal',
          description: 'Get a maker goal by ID. Returns cleaned data in TOON format.',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Goal ID' },
              save_dir: { type: 'string', description: 'Directory to save cleaned JSON data' },
            },
            required: ['id'],
          },
        } as Tool,
        {
          name: 'get_goals',
          description: 'Get maker goals. Returns cleaned data in TOON format.',
          inputSchema: {
            type: 'object',
            properties: {
              userId: { type: 'string', description: 'Filter by user ID' },
              makerGroupId: { type: 'string', description: 'Filter by maker group ID' },
              completed: { type: 'boolean', description: 'Filter by completion status' },
              order: { type: 'string', description: 'Order: CHEERS_COUNT, NEWEST', enum: ['CHEERS_COUNT', 'NEWEST'] },
              first: { type: 'integer', description: 'Number to return (default: 10)', default: 10 },
              after: { type: 'string', description: 'Cursor for pagination' },
              save_dir: { type: 'string', description: 'Directory to save cleaned JSON data' },
              max_items: { type: 'integer', description: 'Max items (default: 10)', default: 10 },
            },
            required: [],
          },
        } as Tool,
        {
          name: 'get_maker_group',
          description: 'Get a maker group by ID. Returns cleaned data in TOON format.',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Maker group ID' },
              save_dir: { type: 'string', description: 'Directory to save cleaned JSON data' },
            },
            required: ['id'],
          },
        } as Tool,
        {
          name: 'get_maker_groups',
          description: 'Get maker groups. Returns cleaned data in TOON format.',
          inputSchema: {
            type: 'object',
            properties: {
              userId: { type: 'string', description: 'Filter by user ID' },
              order: { type: 'string', description: 'Order: MEMBERS_COUNT, NEWEST', enum: ['MEMBERS_COUNT', 'NEWEST'] },
              first: { type: 'integer', description: 'Number to return (default: 10)', default: 10 },
              after: { type: 'string', description: 'Cursor for pagination' },
              save_dir: { type: 'string', description: 'Directory to save cleaned JSON data' },
              max_items: { type: 'integer', description: 'Max items (default: 10)', default: 10 },
            },
            required: [],
          },
        } as Tool,
        {
          name: 'get_viewer',
          description: 'Get authenticated user info. Returns cleaned data in TOON format.',
          inputSchema: {
            type: 'object',
            properties: {
              save_dir: { type: 'string', description: 'Directory to save cleaned JSON data' },
            },
            required: [],
          },
        } as Tool,
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params;
        if (!args) throw new McpError(ErrorCode.InvalidParams, 'Missing arguments');

        switch (name) {
          case 'get_post': return await this.getPost(args as Record<string, any>);
          case 'get_posts': return await this.getPosts(args as Record<string, any>);
          case 'search_posts': return await this.searchPosts(args as Record<string, any>);
          case 'get_collection': return await this.getCollection(args as Record<string, any>);
          case 'get_collections': return await this.getCollections(args as Record<string, any>);
          case 'get_user': return await this.getUser(args as Record<string, any>);
          case 'get_user_posts': return await this.getUserPosts(args as Record<string, any>);
          case 'get_user_voted_posts': return await this.getUserVotedPosts(args as Record<string, any>);
          case 'get_topic': return await this.getTopic(args as Record<string, any>);
          case 'get_topics': return await this.getTopics(args as Record<string, any>);
          case 'get_comment': return await this.getComment(args as Record<string, any>);
          case 'get_post_comments': return await this.getPostComments(args as Record<string, any>);
          case 'get_goal': return await this.getGoal(args as Record<string, any>);
          case 'get_goals': return await this.getGoals(args as Record<string, any>);
          case 'get_maker_group': return await this.getMakerGroup(args as Record<string, any>);
          case 'get_maker_groups': return await this.getMakerGroups(args as Record<string, any>);
          case 'get_viewer': return await this.getViewer(args as Record<string, any>);
          default: throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        if (error instanceof McpError) throw error;
        const message = error instanceof Error ? error.message : 'Unknown error';
        throw new McpError(ErrorCode.InternalError, `Product Hunt API error: ${message}`);
      }
    });
  }

  private async executeGraphQL<T>(query: string, variables?: Record<string, any>): Promise<T> {
    const config: AxiosRequestConfig = { headers: {} };
    if (this.accessToken && config.headers) {
      config.headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const response = await this.apiClient.post<GraphQLResponse<T>>('/graphql', { query, variables }, config);

    if (response.data.errors?.length) {
      throw new Error(`GraphQL: ${response.data.errors.map(e => e.message).join('; ')}`);
    }
    if (!response.data.data) throw new Error('No data returned');
    return response.data.data;
  }

  private saveData(data: any, dir: string, toolName: string): string {
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const filename = `${toolName}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      const filepath = path.join(dir, filename);
      fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
      return filepath;
    } catch (e) {
      return `Error saving: ${e}`;
    }
  }

  private formatResponse(cleanedData: any, options: { saveDir?: string; toolName?: string; pagination?: any }): CallToolResult {
    const output: any = { data: cleanedData };
    if (options.pagination) {
      output.pagination = {
        hasNextPage: options.pagination.hasNextPage,
        endCursor: options.pagination.endCursor,
        total: options.pagination.totalCount,
      };
    }

    let savedPath = '';
    if (options.saveDir && options.toolName) {
      savedPath = this.saveData(output, options.saveDir, options.toolName);
    }

    let text = encode(output);
    if (savedPath) text += `\n\n[Cleaned data saved to: ${savedPath}]`;

    return { content: [{ type: 'text', text }] };
  }

  // Post methods
  private async getPost(args: Record<string, any>): Promise<CallToolResult> {
    if (!args.id && !args.slug) throw new Error('At least one of id or slug is required');

    const query = `
      query($id: ID, $slug: String) {
        post(id: $id, slug: $slug) {
          id slug name tagline description url votesCount commentsCount reviewsRating featuredAt createdAt website
          thumbnail { url }
          topics { edges { node { id name slug } } }
          makers { id name username }
          user { id name username }
        }
      }
    `;

    const data = await this.executeGraphQL<{ post: any }>(query, { id: args.id, slug: args.slug });
    return this.formatResponse(DataCleaners.cleanPost(data.post), { saveDir: args.save_dir, toolName: 'get_post' });
  }

  private async getPosts(args: Record<string, any>): Promise<CallToolResult> {
    const query = `
      query($featured: Boolean, $topic: String, $postedAfter: DateTime, $postedBefore: DateTime, $order: PostsOrder, $first: Int, $after: String) {
        posts(featured: $featured, topic: $topic, postedAfter: $postedAfter, postedBefore: $postedBefore, order: $order, first: $first, after: $after) {
          edges { node { id slug name tagline votesCount commentsCount featuredAt createdAt topics { edges { node { name } } } } }
          pageInfo { hasNextPage endCursor }
          totalCount
        }
      }
    `;

    const data = await this.executeGraphQL<{ posts: any }>(query, {
      featured: args.featured, topic: args.topic, postedAfter: args.postedAfter, postedBefore: args.postedBefore,
      order: args.order, first: args.first || 10, after: args.after,
    });

    const maxItems = args.max_items || 10;
    const cleaned = data.posts.edges.slice(0, maxItems).map((e: any) => DataCleaners.cleanPostListItem(e.node));

    return this.formatResponse(cleaned, {
      saveDir: args.save_dir, toolName: 'get_posts',
      pagination: { ...data.posts.pageInfo, totalCount: data.posts.totalCount },
    });
  }

  private async searchPosts(args: Record<string, any>): Promise<CallToolResult> {
    const query = `
      query($first: Int, $after: String) {
        posts(order: RANKING, first: $first, after: $after) {
          edges { node { id slug name tagline votesCount commentsCount featuredAt topics { edges { node { name } } } } }
          pageInfo { hasNextPage endCursor }
          totalCount
        }
      }
    `;

    const data = await this.executeGraphQL<{ posts: any }>(query, { first: args.first || 20, after: args.after });

    const searchQuery = (args.query as string).toLowerCase();
    const filtered = data.posts.edges.filter((e: any) =>
      e.node.name.toLowerCase().includes(searchQuery) || e.node.tagline.toLowerCase().includes(searchQuery)
    );

    const maxItems = args.max_items || 10;
    const cleaned = filtered.slice(0, maxItems).map((e: any) => DataCleaners.cleanPostListItem(e.node));

    return this.formatResponse(cleaned, {
      saveDir: args.save_dir, toolName: 'search_posts',
      pagination: { ...data.posts.pageInfo, totalCount: filtered.length },
    });
  }

  // Collection methods
  private async getCollection(args: Record<string, any>): Promise<CallToolResult> {
    const query = `
      query($id: ID) {
        collection(id: $id) {
          id name description followersCount coverImage createdAt
          user { id name username }
          posts(first: 10) { totalCount edges { node { id name tagline slug } } }
        }
      }
    `;

    const data = await this.executeGraphQL<{ collection: any }>(query, { id: args.id });
    return this.formatResponse(DataCleaners.cleanCollection(data.collection), { saveDir: args.save_dir, toolName: 'get_collection' });
  }

  private async getCollections(args: Record<string, any>): Promise<CallToolResult> {
    const query = `
      query($featured: Boolean, $userId: ID, $postId: ID, $order: CollectionsOrder, $first: Int, $after: String) {
        collections(featured: $featured, userId: $userId, postId: $postId, order: $order, first: $first, after: $after) {
          edges { node { id name description followersCount createdAt user { name } } }
          pageInfo { hasNextPage endCursor }
          totalCount
        }
      }
    `;

    const data = await this.executeGraphQL<{ collections: any }>(query, {
      featured: args.featured, userId: args.userId, postId: args.postId, order: args.order, first: args.first || 10, after: args.after,
    });

    const maxItems = args.max_items || 10;
    const cleaned = data.collections.edges.slice(0, maxItems).map((e: any) => DataCleaners.cleanCollection(e.node));

    return this.formatResponse(cleaned, {
      saveDir: args.save_dir, toolName: 'get_collections',
      pagination: { ...data.collections.pageInfo, totalCount: data.collections.totalCount },
    });
  }

  // User methods
  private async getUser(args: Record<string, any>): Promise<CallToolResult> {
    if (!args.id && !args.username) throw new Error('At least one of id or username is required');

    const query = `
      query($id: ID, $username: String) {
        user(id: $id, username: $username) {
          id username name headline profileImage coverImage websiteUrl twitterUsername followersCount followingCount isMaker
          madePosts { totalCount }
          votedPosts { totalCount }
        }
      }
    `;

    const data = await this.executeGraphQL<{ user: any }>(query, { id: args.id, username: args.username });
    return this.formatResponse(DataCleaners.cleanUser(data.user), { saveDir: args.save_dir, toolName: 'get_user' });
  }

  private async getUserPosts(args: Record<string, any>): Promise<CallToolResult> {
    const query = `
      query($username: String!, $first: Int, $after: String) {
        user(username: $username) {
          id username name
          madePosts(first: $first, after: $after) {
            edges { node { id slug name tagline votesCount commentsCount featuredAt createdAt } }
            pageInfo { hasNextPage endCursor }
            totalCount
          }
        }
      }
    `;

    const data = await this.executeGraphQL<{ user: any }>(query, { username: args.username, first: args.first || 10, after: args.after });

    const maxItems = args.max_items || 10;
    const cleaned = {
      user: { id: data.user.id, username: data.user.username, name: data.user.name },
      posts: data.user.madePosts.edges.slice(0, maxItems).map((e: any) => DataCleaners.cleanPostListItem(e.node)),
    };

    return this.formatResponse(cleaned, {
      saveDir: args.save_dir, toolName: 'get_user_posts',
      pagination: { ...data.user.madePosts.pageInfo, totalCount: data.user.madePosts.totalCount },
    });
  }

  private async getUserVotedPosts(args: Record<string, any>): Promise<CallToolResult> {
    const query = `
      query($username: String!, $first: Int, $after: String) {
        user(username: $username) {
          id username name
          votedPosts(first: $first, after: $after) {
            edges { node { id slug name tagline votesCount commentsCount featuredAt createdAt } }
            pageInfo { hasNextPage endCursor }
            totalCount
          }
        }
      }
    `;

    const data = await this.executeGraphQL<{ user: any }>(query, { username: args.username, first: args.first || 10, after: args.after });

    const maxItems = args.max_items || 10;
    const cleaned = {
      user: { id: data.user.id, username: data.user.username, name: data.user.name },
      posts: data.user.votedPosts.edges.slice(0, maxItems).map((e: any) => DataCleaners.cleanPostListItem(e.node)),
    };

    return this.formatResponse(cleaned, {
      saveDir: args.save_dir, toolName: 'get_user_voted_posts',
      pagination: { ...data.user.votedPosts.pageInfo, totalCount: data.user.votedPosts.totalCount },
    });
  }

  // Topic methods
  private async getTopic(args: Record<string, any>): Promise<CallToolResult> {
    if (!args.id && !args.slug) throw new Error('At least one of id or slug is required');

    const query = `
      query($id: ID, $slug: String) {
        topic(id: $id, slug: $slug) { id slug name description followersCount postsCount }
      }
    `;

    const data = await this.executeGraphQL<{ topic: any }>(query, { id: args.id, slug: args.slug });
    return this.formatResponse(DataCleaners.cleanTopic(data.topic), { saveDir: args.save_dir, toolName: 'get_topic' });
  }

  private async getTopics(args: Record<string, any>): Promise<CallToolResult> {
    const query = `
      query($search: String, $order: TopicsOrder, $first: Int, $after: String) {
        topics(query: $search, order: $order, first: $first, after: $after) {
          edges { node { id slug name description followersCount postsCount } }
          pageInfo { hasNextPage endCursor }
          totalCount
        }
      }
    `;

    const data = await this.executeGraphQL<{ topics: any }>(query, { search: args.search, order: args.order, first: args.first || 10, after: args.after });

    const maxItems = args.max_items || 10;
    const cleaned = data.topics.edges.slice(0, maxItems).map((e: any) => DataCleaners.cleanTopic(e.node));

    return this.formatResponse(cleaned, {
      saveDir: args.save_dir, toolName: 'get_topics',
      pagination: { ...data.topics.pageInfo, totalCount: data.topics.totalCount },
    });
  }

  // Comment methods
  private async getComment(args: Record<string, any>): Promise<CallToolResult> {
    const query = `
      query($id: ID!) {
        comment(id: $id) { id body votesCount createdAt user { id name username } replies { totalCount } }
      }
    `;

    const data = await this.executeGraphQL<{ comment: any }>(query, { id: args.id });
    return this.formatResponse(DataCleaners.cleanComment(data.comment), { saveDir: args.save_dir, toolName: 'get_comment' });
  }

  private async getPostComments(args: Record<string, any>): Promise<CallToolResult> {
    if (!args.postId && !args.postSlug) throw new Error('At least one of postId or postSlug is required');

    const query = `
      query($postId: ID, $postSlug: String, $order: CommentsOrder, $first: Int, $after: String) {
        post(id: $postId, slug: $postSlug) {
          id name
          comments(order: $order, first: $first, after: $after) {
            edges { node { id body votesCount createdAt user { name } replies { totalCount } } }
            pageInfo { hasNextPage endCursor }
            totalCount
          }
        }
      }
    `;

    const data = await this.executeGraphQL<{ post: any }>(query, {
      postId: args.postId, postSlug: args.postSlug, order: args.order, first: args.first || 10, after: args.after,
    });

    const maxItems = args.max_items || 10;
    const cleaned = {
      post: { id: data.post.id, name: data.post.name },
      comments: data.post.comments.edges.slice(0, maxItems).map((e: any) => DataCleaners.cleanComment(e.node)),
    };

    return this.formatResponse(cleaned, {
      saveDir: args.save_dir, toolName: 'get_post_comments',
      pagination: { ...data.post.comments.pageInfo, totalCount: data.post.comments.totalCount },
    });
  }

  // Goal methods
  private async getGoal(args: Record<string, any>): Promise<CallToolResult> {
    const query = `
      query($id: ID!) {
        goal(id: $id) {
          id title dueAt completedAt isCompleted cheersCount focusedDuration
          user { id name username }
          makerGroup { id name }
          project { id name }
        }
      }
    `;

    const data = await this.executeGraphQL<{ goal: any }>(query, { id: args.id });
    return this.formatResponse(DataCleaners.cleanGoal(data.goal), { saveDir: args.save_dir, toolName: 'get_goal' });
  }

  private async getGoals(args: Record<string, any>): Promise<CallToolResult> {
    const query = `
      query($userId: ID, $makerGroupId: ID, $completed: Boolean, $order: GoalsOrder, $first: Int, $after: String) {
        goals(userId: $userId, makerGroupId: $makerGroupId, completed: $completed, order: $order, first: $first, after: $after) {
          edges { node { id title dueAt isCompleted cheersCount user { name } makerGroup { name } } }
          pageInfo { hasNextPage endCursor }
          totalCount
        }
      }
    `;

    const data = await this.executeGraphQL<{ goals: any }>(query, {
      userId: args.userId, makerGroupId: args.makerGroupId, completed: args.completed, order: args.order, first: args.first || 10, after: args.after,
    });

    const maxItems = args.max_items || 10;
    const cleaned = data.goals.edges.slice(0, maxItems).map((e: any) => DataCleaners.cleanGoal(e.node));

    return this.formatResponse(cleaned, {
      saveDir: args.save_dir, toolName: 'get_goals',
      pagination: { ...data.goals.pageInfo, totalCount: data.goals.totalCount },
    });
  }

  // Maker Group methods
  private async getMakerGroup(args: Record<string, any>): Promise<CallToolResult> {
    const query = `
      query($id: ID!) {
        makerGroup(id: $id) { id name tagline description membersCount goalsCount createdAt }
      }
    `;

    const data = await this.executeGraphQL<{ makerGroup: any }>(query, { id: args.id });
    return this.formatResponse(DataCleaners.cleanMakerGroup(data.makerGroup), { saveDir: args.save_dir, toolName: 'get_maker_group' });
  }

  private async getMakerGroups(args: Record<string, any>): Promise<CallToolResult> {
    const query = `
      query($userId: ID, $order: MakerGroupsOrder, $first: Int, $after: String) {
        makerGroups(userId: $userId, order: $order, first: $first, after: $after) {
          edges { node { id name tagline description membersCount goalsCount createdAt } }
          pageInfo { hasNextPage endCursor }
          totalCount
        }
      }
    `;

    const data = await this.executeGraphQL<{ makerGroups: any }>(query, { userId: args.userId, order: args.order, first: args.first || 10, after: args.after });

    const maxItems = args.max_items || 10;
    const cleaned = data.makerGroups.edges.slice(0, maxItems).map((e: any) => DataCleaners.cleanMakerGroup(e.node));

    return this.formatResponse(cleaned, {
      saveDir: args.save_dir, toolName: 'get_maker_groups',
      pagination: { ...data.makerGroups.pageInfo, totalCount: data.makerGroups.totalCount },
    });
  }

  // Viewer method
  private async getViewer(args: Record<string, any>): Promise<CallToolResult> {
    const query = `
      query {
        viewer {
          user { id username name headline profileImage isMaker }
          goals(first: 5, order: NEWEST) { totalCount edges { node { id title isCompleted } } }
          makerGroups(first: 5) { totalCount edges { node { id name } } }
        }
      }
    `;

    const data = await this.executeGraphQL<{ viewer: any }>(query);

    const cleaned = {
      user: DataCleaners.cleanUser(data.viewer.user),
      recentGoals: data.viewer.goals?.edges?.map((e: any) => ({ id: e.node.id, title: e.node.title, isCompleted: e.node.isCompleted })) || [],
      makerGroups: data.viewer.makerGroups?.edges?.map((e: any) => ({ id: e.node.id, name: e.node.name })) || [],
    };

    return this.formatResponse(cleaned, { saveDir: args.save_dir, toolName: 'get_viewer' });
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

const server = new ProductHuntAPIMCPServer();
server.run().catch(console.error);
