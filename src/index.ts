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

/**
 * Interface definitions for Product Hunt GraphQL API responses
 */
interface ProductHuntPost {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  description?: string;
  url: string;
  votesCount: number;
  commentsCount: number;
  reviewsRating?: number;
  featuredAt?: string;
  createdAt: string;
  website?: string;
  thumbnail?: {
    url: string;
  };
  media?: Array<{
    type: string;
    url: string;
  }>;
  topics?: {
    edges: Array<{
      node: {
        id: string;
        name: string;
        slug: string;
      };
    }>;
  };
  makers?: Array<{
    id: string;
    name: string;
    username: string;
  }>;
  user?: {
    id: string;
    name: string;
    username: string;
  };
}

interface ProductHuntCollection {
  id: string;
  slug: string;
  name: string;
  description?: string;
  followersCount: number;
  postsCount: number;
  coverImage?: string;
  createdAt: string;
  user?: {
    id: string;
    name: string;
    username: string;
  };
}

interface ProductHuntUser {
  id: string;
  username: string;
  name: string;
  headline?: string;
  profileImage?: string;
  coverImage?: string;
  websiteUrl?: string;
  twitterUsername?: string;
  followersCount?: number;
  followingCount?: number;
  isMaker?: boolean;
  madePosts?: {
    totalCount: number;
  };
  votedPosts?: {
    totalCount: number;
  };
}

interface ProductHuntTopic {
  id: string;
  slug: string;
  name: string;
  description?: string;
  followersCount: number;
  postsCount: number;
}

interface ProductHuntComment {
  id: string;
  body: string;
  votesCount: number;
  createdAt: string;
  user?: {
    id: string;
    name: string;
    username: string;
  };
  replies?: {
    totalCount: number;
  };
}

interface ProductHuntGoal {
  id: string;
  title: string;
  dueAt?: string;
  completedAt?: string;
  isCompleted: boolean;
  cheersCount: number;
  focusedDuration?: number;
  user?: {
    id: string;
    name: string;
    username: string;
  };
  makerGroup?: {
    id: string;
    name: string;
  };
  project?: {
    id: string;
    name: string;
  };
}

interface ProductHuntMakerGroup {
  id: string;
  name: string;
  tagline?: string;
  description?: string;
  membersCount: number;
  goalsCount: number;
  createdAt: string;
}

interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor?: string;
  endCursor?: string;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{
    message: string;
    locations?: Array<{ line: number; column: number }>;
    path?: string[];
  }>;
}

/**
 * Product Hunt API MCP Server
 * Provides access to Product Hunt data through GraphQL API v2
 */
class ProductHuntAPIMCPServer {
  private server: Server;
  private apiClient: AxiosInstance;
  private accessToken: string;

  constructor() {
    // Get access token from environment
    this.accessToken = process.env.PRODUCTHUNT_ACCESS_TOKEN || process.env.PH_ACCESS_TOKEN || '';

    this.server = new Server(
      {
        name: 'producthunt-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Configure axios client with proxy support
    const axiosConfig: AxiosRequestConfig = {
      baseURL: 'https://api.producthunt.com/v2/api',
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'ProductHunt-MCP-Server/1.0.0'
      }
    };

    // Proxy support for enterprise environments
    const proxyUrl = process.env.PROXY_URL || process.env.HTTP_PROXY || process.env.HTTPS_PROXY;
    if (proxyUrl) {
      axiosConfig.httpsAgent = new HttpsProxyAgent(proxyUrl);
      axiosConfig.proxy = false;
    }

    this.apiClient = axios.create(axiosConfig);

    this.setupToolHandlers();
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          // Post endpoints
          {
            name: 'get_post',
            description: 'Get a Product Hunt post by ID or slug',
            inputSchema: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'Post ID',
                },
                slug: {
                  type: 'string',
                  description: 'Post slug (URL-friendly name)',
                },
              },
              required: [],
            },
          } as Tool,
          {
            name: 'get_posts',
            description: 'Get Product Hunt posts with filtering and ordering options',
            inputSchema: {
              type: 'object',
              properties: {
                featured: {
                  type: 'boolean',
                  description: 'Filter by featured posts only',
                },
                topic: {
                  type: 'string',
                  description: 'Filter by topic slug',
                },
                postedAfter: {
                  type: 'string',
                  description: 'Filter posts after this date (ISO 8601 format)',
                },
                postedBefore: {
                  type: 'string',
                  description: 'Filter posts before this date (ISO 8601 format)',
                },
                order: {
                  type: 'string',
                  description: 'Order by: FEATURED_AT, NEWEST, RANKING, VOTES',
                  enum: ['FEATURED_AT', 'NEWEST', 'RANKING', 'VOTES'],
                },
                first: {
                  type: 'integer',
                  description: 'Number of posts to return (default: 10, max: 20)',
                  default: 10,
                },
                after: {
                  type: 'string',
                  description: 'Cursor for pagination (endCursor from previous response)',
                },
              },
              required: [],
            },
          } as Tool,
          {
            name: 'search_posts',
            description: 'Search Product Hunt posts by query',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query',
                },
                first: {
                  type: 'integer',
                  description: 'Number of posts to return (default: 10, max: 20)',
                  default: 10,
                },
                after: {
                  type: 'string',
                  description: 'Cursor for pagination',
                },
              },
              required: ['query'],
            },
          } as Tool,

          // Collection endpoints
          {
            name: 'get_collection',
            description: 'Get a Product Hunt collection by ID or slug',
            inputSchema: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'Collection ID',
                },
                slug: {
                  type: 'string',
                  description: 'Collection slug',
                },
              },
              required: [],
            },
          } as Tool,
          {
            name: 'get_collections',
            description: 'Get Product Hunt collections with filtering options',
            inputSchema: {
              type: 'object',
              properties: {
                featured: {
                  type: 'boolean',
                  description: 'Filter by featured collections only',
                },
                userId: {
                  type: 'string',
                  description: 'Filter by user ID',
                },
                postId: {
                  type: 'string',
                  description: 'Filter by post ID (collections containing this post)',
                },
                order: {
                  type: 'string',
                  description: 'Order by: FEATURED_AT, FOLLOWERS_COUNT, NEWEST',
                  enum: ['FEATURED_AT', 'FOLLOWERS_COUNT', 'NEWEST'],
                },
                first: {
                  type: 'integer',
                  description: 'Number of collections to return (default: 10, max: 20)',
                  default: 10,
                },
                after: {
                  type: 'string',
                  description: 'Cursor for pagination',
                },
              },
              required: [],
            },
          } as Tool,

          // User endpoints
          {
            name: 'get_user',
            description: 'Get a Product Hunt user by ID or username',
            inputSchema: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'User ID',
                },
                username: {
                  type: 'string',
                  description: 'Username',
                },
              },
              required: [],
            },
          } as Tool,
          {
            name: 'get_user_posts',
            description: 'Get posts made by a specific user',
            inputSchema: {
              type: 'object',
              properties: {
                username: {
                  type: 'string',
                  description: 'Username',
                },
                first: {
                  type: 'integer',
                  description: 'Number of posts to return (default: 10, max: 20)',
                  default: 10,
                },
                after: {
                  type: 'string',
                  description: 'Cursor for pagination',
                },
              },
              required: ['username'],
            },
          } as Tool,
          {
            name: 'get_user_voted_posts',
            description: 'Get posts upvoted by a specific user',
            inputSchema: {
              type: 'object',
              properties: {
                username: {
                  type: 'string',
                  description: 'Username',
                },
                first: {
                  type: 'integer',
                  description: 'Number of posts to return (default: 10, max: 20)',
                  default: 10,
                },
                after: {
                  type: 'string',
                  description: 'Cursor for pagination',
                },
              },
              required: ['username'],
            },
          } as Tool,

          // Topic endpoints
          {
            name: 'get_topic',
            description: 'Get a Product Hunt topic by ID or slug',
            inputSchema: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'Topic ID',
                },
                slug: {
                  type: 'string',
                  description: 'Topic slug',
                },
              },
              required: [],
            },
          } as Tool,
          {
            name: 'get_topics',
            description: 'Get Product Hunt topics with filtering options',
            inputSchema: {
              type: 'object',
              properties: {
                search: {
                  type: 'string',
                  description: 'Search topics by name',
                },
                order: {
                  type: 'string',
                  description: 'Order by: FOLLOWERS_COUNT, NEWEST',
                  enum: ['FOLLOWERS_COUNT', 'NEWEST'],
                },
                first: {
                  type: 'integer',
                  description: 'Number of topics to return (default: 10, max: 20)',
                  default: 10,
                },
                after: {
                  type: 'string',
                  description: 'Cursor for pagination',
                },
              },
              required: [],
            },
          } as Tool,

          // Comment endpoints
          {
            name: 'get_comment',
            description: 'Get a Product Hunt comment by ID',
            inputSchema: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'Comment ID',
                },
              },
              required: ['id'],
            },
          } as Tool,
          {
            name: 'get_post_comments',
            description: 'Get comments on a specific post',
            inputSchema: {
              type: 'object',
              properties: {
                postId: {
                  type: 'string',
                  description: 'Post ID',
                },
                postSlug: {
                  type: 'string',
                  description: 'Post slug',
                },
                order: {
                  type: 'string',
                  description: 'Order by: NEWEST, VOTES_COUNT',
                  enum: ['NEWEST', 'VOTES_COUNT'],
                },
                first: {
                  type: 'integer',
                  description: 'Number of comments to return (default: 10, max: 20)',
                  default: 10,
                },
                after: {
                  type: 'string',
                  description: 'Cursor for pagination',
                },
              },
              required: [],
            },
          } as Tool,

          // Goal endpoints
          {
            name: 'get_goal',
            description: 'Get a maker goal by ID',
            inputSchema: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'Goal ID',
                },
              },
              required: ['id'],
            },
          } as Tool,
          {
            name: 'get_goals',
            description: 'Get maker goals with filtering options',
            inputSchema: {
              type: 'object',
              properties: {
                userId: {
                  type: 'string',
                  description: 'Filter by user ID',
                },
                makerGroupId: {
                  type: 'string',
                  description: 'Filter by maker group ID',
                },
                completed: {
                  type: 'boolean',
                  description: 'Filter by completion status',
                },
                order: {
                  type: 'string',
                  description: 'Order by: COMPLETED_AT, DUE_AT, NEWEST',
                  enum: ['COMPLETED_AT', 'DUE_AT', 'NEWEST'],
                },
                first: {
                  type: 'integer',
                  description: 'Number of goals to return (default: 10, max: 20)',
                  default: 10,
                },
                after: {
                  type: 'string',
                  description: 'Cursor for pagination',
                },
              },
              required: [],
            },
          } as Tool,

          // Maker Group endpoints
          {
            name: 'get_maker_group',
            description: 'Get a maker group (Space) by ID',
            inputSchema: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'Maker Group ID',
                },
              },
              required: ['id'],
            },
          } as Tool,
          {
            name: 'get_maker_groups',
            description: 'Get maker groups (Spaces) with filtering options',
            inputSchema: {
              type: 'object',
              properties: {
                userId: {
                  type: 'string',
                  description: 'Filter by user ID (groups the user is a member of)',
                },
                order: {
                  type: 'string',
                  description: 'Order by: GOALS_COUNT, LAST_ACTIVE, MEMBERS_COUNT, NEWEST',
                  enum: ['GOALS_COUNT', 'LAST_ACTIVE', 'MEMBERS_COUNT', 'NEWEST'],
                },
                first: {
                  type: 'integer',
                  description: 'Number of groups to return (default: 10, max: 20)',
                  default: 10,
                },
                after: {
                  type: 'string',
                  description: 'Cursor for pagination',
                },
              },
              required: [],
            },
          } as Tool,

          // Viewer endpoint (authenticated user)
          {
            name: 'get_viewer',
            description: 'Get the authenticated user information and their data',
            inputSchema: {
              type: 'object',
              properties: {},
              required: [],
            },
          } as Tool,
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params;

        if (!args) {
          throw new McpError(ErrorCode.InvalidParams, 'Missing arguments');
        }

        switch (name) {
          // Post endpoints
          case 'get_post':
            return await this.getPost(args as Record<string, any>);
          case 'get_posts':
            return await this.getPosts(args as Record<string, any>);
          case 'search_posts':
            return await this.searchPosts(args as Record<string, any>);

          // Collection endpoints
          case 'get_collection':
            return await this.getCollection(args as Record<string, any>);
          case 'get_collections':
            return await this.getCollections(args as Record<string, any>);

          // User endpoints
          case 'get_user':
            return await this.getUser(args as Record<string, any>);
          case 'get_user_posts':
            return await this.getUserPosts(args as Record<string, any>);
          case 'get_user_voted_posts':
            return await this.getUserVotedPosts(args as Record<string, any>);

          // Topic endpoints
          case 'get_topic':
            return await this.getTopic(args as Record<string, any>);
          case 'get_topics':
            return await this.getTopics(args as Record<string, any>);

          // Comment endpoints
          case 'get_comment':
            return await this.getComment(args.id as string);
          case 'get_post_comments':
            return await this.getPostComments(args as Record<string, any>);

          // Goal endpoints
          case 'get_goal':
            return await this.getGoal(args.id as string);
          case 'get_goals':
            return await this.getGoals(args as Record<string, any>);

          // Maker Group endpoints
          case 'get_maker_group':
            return await this.getMakerGroup(args.id as string);
          case 'get_maker_groups':
            return await this.getMakerGroups(args as Record<string, any>);

          // Viewer endpoint
          case 'get_viewer':
            return await this.getViewer();

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }

        const message = error instanceof Error ? error.message : 'Unknown error occurred';
        throw new McpError(ErrorCode.InternalError, `Product Hunt API error: ${message}`);
      }
    });
  }

  private async executeGraphQL<T>(query: string, variables?: Record<string, any>): Promise<T> {
    try {
      const config: AxiosRequestConfig = {
        headers: {},
      };

      // Add access token if available
      if (this.accessToken && config.headers) {
        config.headers['Authorization'] = `Bearer ${this.accessToken}`;
      }

      const response = await this.apiClient.post<GraphQLResponse<T>>(
        '/graphql',
        { query, variables },
        config
      );

      if (response.data.errors && response.data.errors.length > 0) {
        const errorMessages = response.data.errors.map(e => e.message).join('; ');
        throw new Error(`GraphQL errors: ${errorMessages}`);
      }

      if (!response.data.data) {
        throw new Error('No data returned from API');
      }

      return response.data.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const statusCode = error.response?.status || 500;
        const errorMessage = error.response?.data?.errors?.[0]?.message ||
                           error.response?.data?.message ||
                           error.message;
        throw new Error(`Product Hunt API error (${statusCode}): ${errorMessage}`);
      }
      throw error;
    }
  }

  private formatResponse(data: any): CallToolResult {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }

  // Post methods
  private async getPost(args: Record<string, any>): Promise<CallToolResult> {
    if (!args.id && !args.slug) {
      throw new Error('At least one of id or slug is required');
    }

    const query = `
      query GetPost($id: ID, $slug: String) {
        post(id: $id, slug: $slug) {
          id
          slug
          name
          tagline
          description
          url
          votesCount
          commentsCount
          reviewsRating
          featuredAt
          createdAt
          website
          thumbnail {
            url
          }
          media {
            type
            url
          }
          topics {
            edges {
              node {
                id
                name
                slug
              }
            }
          }
          makers {
            id
            name
            username
          }
          user {
            id
            name
            username
          }
        }
      }
    `;

    const data = await this.executeGraphQL<{ post: ProductHuntPost }>(query, {
      id: args.id,
      slug: args.slug,
    });

    return this.formatResponse(data.post);
  }

  private async getPosts(args: Record<string, any>): Promise<CallToolResult> {
    const query = `
      query GetPosts($featured: Boolean, $topic: String, $postedAfter: DateTime, $postedBefore: DateTime, $order: PostsOrder, $first: Int, $after: String) {
        posts(featured: $featured, topic: $topic, postedAfter: $postedAfter, postedBefore: $postedBefore, order: $order, first: $first, after: $after) {
          edges {
            cursor
            node {
              id
              slug
              name
              tagline
              url
              votesCount
              commentsCount
              featuredAt
              createdAt
              thumbnail {
                url
              }
              topics {
                edges {
                  node {
                    id
                    name
                    slug
                  }
                }
              }
              makers {
                id
                name
                username
              }
            }
          }
          pageInfo {
            hasNextPage
            hasPreviousPage
            startCursor
            endCursor
          }
          totalCount
        }
      }
    `;

    const data = await this.executeGraphQL<{ posts: { edges: Array<{ cursor: string; node: ProductHuntPost }>; pageInfo: PageInfo; totalCount: number } }>(query, {
      featured: args.featured,
      topic: args.topic,
      postedAfter: args.postedAfter,
      postedBefore: args.postedBefore,
      order: args.order,
      first: args.first || 10,
      after: args.after,
    });

    return this.formatResponse(data.posts);
  }

  private async searchPosts(args: Record<string, any>): Promise<CallToolResult> {
    // Product Hunt doesn't have a direct search query, so we use posts with topic filter
    // For a more comprehensive search, we'd need to use a different approach
    const query = `
      query SearchPosts($first: Int, $after: String) {
        posts(order: RANKING, first: $first, after: $after) {
          edges {
            cursor
            node {
              id
              slug
              name
              tagline
              url
              votesCount
              commentsCount
              featuredAt
              createdAt
              thumbnail {
                url
              }
              topics {
                edges {
                  node {
                    id
                    name
                    slug
                  }
                }
              }
            }
          }
          pageInfo {
            hasNextPage
            hasPreviousPage
            startCursor
            endCursor
          }
          totalCount
        }
      }
    `;

    const data = await this.executeGraphQL<{ posts: { edges: Array<{ cursor: string; node: ProductHuntPost }>; pageInfo: PageInfo; totalCount: number } }>(query, {
      first: args.first || 10,
      after: args.after,
    });

    // Filter results by search query on client side
    const searchQuery = (args.query as string).toLowerCase();
    const filteredEdges = data.posts.edges.filter(edge =>
      edge.node.name.toLowerCase().includes(searchQuery) ||
      edge.node.tagline.toLowerCase().includes(searchQuery)
    );

    return this.formatResponse({
      ...data.posts,
      edges: filteredEdges,
      searchQuery: args.query,
    });
  }

  // Collection methods
  private async getCollection(args: Record<string, any>): Promise<CallToolResult> {
    if (!args.id && !args.slug) {
      throw new Error('At least one of id or slug is required');
    }

    const query = `
      query GetCollection($id: ID, $slug: String) {
        collection(id: $id, slug: $slug) {
          id
          slug
          name
          description
          followersCount
          coverImage
          createdAt
          user {
            id
            name
            username
          }
          posts(first: 10) {
            totalCount
            edges {
              node {
                id
                name
                tagline
                slug
              }
            }
          }
        }
      }
    `;

    const data = await this.executeGraphQL<{ collection: ProductHuntCollection }>(query, {
      id: args.id,
      slug: args.slug,
    });

    return this.formatResponse(data.collection);
  }

  private async getCollections(args: Record<string, any>): Promise<CallToolResult> {
    const query = `
      query GetCollections($featured: Boolean, $userId: ID, $postId: ID, $order: CollectionsOrder, $first: Int, $after: String) {
        collections(featured: $featured, userId: $userId, postId: $postId, order: $order, first: $first, after: $after) {
          edges {
            cursor
            node {
              id
              slug
              name
              description
              followersCount
              coverImage
              createdAt
              user {
                id
                name
                username
              }
            }
          }
          pageInfo {
            hasNextPage
            hasPreviousPage
            startCursor
            endCursor
          }
          totalCount
        }
      }
    `;

    const data = await this.executeGraphQL<{ collections: { edges: Array<{ cursor: string; node: ProductHuntCollection }>; pageInfo: PageInfo; totalCount: number } }>(query, {
      featured: args.featured,
      userId: args.userId,
      postId: args.postId,
      order: args.order,
      first: args.first || 10,
      after: args.after,
    });

    return this.formatResponse(data.collections);
  }

  // User methods
  private async getUser(args: Record<string, any>): Promise<CallToolResult> {
    if (!args.id && !args.username) {
      throw new Error('At least one of id or username is required');
    }

    const query = `
      query GetUser($id: ID, $username: String) {
        user(id: $id, username: $username) {
          id
          username
          name
          headline
          profileImage
          coverImage
          websiteUrl
          twitterUsername
          followersCount
          followingCount
          isMaker
          madePosts {
            totalCount
          }
          votedPosts {
            totalCount
          }
        }
      }
    `;

    const data = await this.executeGraphQL<{ user: ProductHuntUser }>(query, {
      id: args.id,
      username: args.username,
    });

    return this.formatResponse(data.user);
  }

  private async getUserPosts(args: Record<string, any>): Promise<CallToolResult> {
    const query = `
      query GetUserPosts($username: String!, $first: Int, $after: String) {
        user(username: $username) {
          id
          username
          name
          madePosts(first: $first, after: $after) {
            edges {
              cursor
              node {
                id
                slug
                name
                tagline
                url
                votesCount
                commentsCount
                featuredAt
                createdAt
              }
            }
            pageInfo {
              hasNextPage
              hasPreviousPage
              startCursor
              endCursor
            }
            totalCount
          }
        }
      }
    `;

    const data = await this.executeGraphQL<{ user: ProductHuntUser & { madePosts: { edges: Array<{ cursor: string; node: ProductHuntPost }>; pageInfo: PageInfo; totalCount: number } } }>(query, {
      username: args.username,
      first: args.first || 10,
      after: args.after,
    });

    return this.formatResponse(data.user);
  }

  private async getUserVotedPosts(args: Record<string, any>): Promise<CallToolResult> {
    const query = `
      query GetUserVotedPosts($username: String!, $first: Int, $after: String) {
        user(username: $username) {
          id
          username
          name
          votedPosts(first: $first, after: $after) {
            edges {
              cursor
              node {
                id
                slug
                name
                tagline
                url
                votesCount
                commentsCount
                featuredAt
                createdAt
              }
            }
            pageInfo {
              hasNextPage
              hasPreviousPage
              startCursor
              endCursor
            }
            totalCount
          }
        }
      }
    `;

    const data = await this.executeGraphQL<{ user: ProductHuntUser & { votedPosts: { edges: Array<{ cursor: string; node: ProductHuntPost }>; pageInfo: PageInfo; totalCount: number } } }>(query, {
      username: args.username,
      first: args.first || 10,
      after: args.after,
    });

    return this.formatResponse(data.user);
  }

  // Topic methods
  private async getTopic(args: Record<string, any>): Promise<CallToolResult> {
    if (!args.id && !args.slug) {
      throw new Error('At least one of id or slug is required');
    }

    const query = `
      query GetTopic($id: ID, $slug: String) {
        topic(id: $id, slug: $slug) {
          id
          slug
          name
          description
          followersCount
          postsCount
        }
      }
    `;

    const data = await this.executeGraphQL<{ topic: ProductHuntTopic }>(query, {
      id: args.id,
      slug: args.slug,
    });

    return this.formatResponse(data.topic);
  }

  private async getTopics(args: Record<string, any>): Promise<CallToolResult> {
    const query = `
      query GetTopics($search: String, $order: TopicsOrder, $first: Int, $after: String) {
        topics(query: $search, order: $order, first: $first, after: $after) {
          edges {
            cursor
            node {
              id
              slug
              name
              description
              followersCount
              postsCount
            }
          }
          pageInfo {
            hasNextPage
            hasPreviousPage
            startCursor
            endCursor
          }
          totalCount
        }
      }
    `;

    const data = await this.executeGraphQL<{ topics: { edges: Array<{ cursor: string; node: ProductHuntTopic }>; pageInfo: PageInfo; totalCount: number } }>(query, {
      search: args.search,
      order: args.order,
      first: args.first || 10,
      after: args.after,
    });

    return this.formatResponse(data.topics);
  }

  // Comment methods
  private async getComment(id: string): Promise<CallToolResult> {
    const query = `
      query GetComment($id: ID!) {
        comment(id: $id) {
          id
          body
          votesCount
          createdAt
          user {
            id
            name
            username
          }
          replies {
            totalCount
          }
        }
      }
    `;

    const data = await this.executeGraphQL<{ comment: ProductHuntComment }>(query, { id });

    return this.formatResponse(data.comment);
  }

  private async getPostComments(args: Record<string, any>): Promise<CallToolResult> {
    if (!args.postId && !args.postSlug) {
      throw new Error('At least one of postId or postSlug is required');
    }

    const query = `
      query GetPostComments($postId: ID, $postSlug: String, $order: CommentsOrder, $first: Int, $after: String) {
        post(id: $postId, slug: $postSlug) {
          id
          name
          comments(order: $order, first: $first, after: $after) {
            edges {
              cursor
              node {
                id
                body
                votesCount
                createdAt
                user {
                  id
                  name
                  username
                }
                replies {
                  totalCount
                }
              }
            }
            pageInfo {
              hasNextPage
              hasPreviousPage
              startCursor
              endCursor
            }
            totalCount
          }
        }
      }
    `;

    const data = await this.executeGraphQL<{ post: ProductHuntPost & { comments: { edges: Array<{ cursor: string; node: ProductHuntComment }>; pageInfo: PageInfo; totalCount: number } } }>(query, {
      postId: args.postId,
      postSlug: args.postSlug,
      order: args.order,
      first: args.first || 10,
      after: args.after,
    });

    return this.formatResponse(data.post);
  }

  // Goal methods
  private async getGoal(id: string): Promise<CallToolResult> {
    const query = `
      query GetGoal($id: ID!) {
        goal(id: $id) {
          id
          title
          dueAt
          completedAt
          isCompleted
          cheersCount
          focusedDuration
          user {
            id
            name
            username
          }
          makerGroup {
            id
            name
          }
          project {
            id
            name
          }
        }
      }
    `;

    const data = await this.executeGraphQL<{ goal: ProductHuntGoal }>(query, { id });

    return this.formatResponse(data.goal);
  }

  private async getGoals(args: Record<string, any>): Promise<CallToolResult> {
    const query = `
      query GetGoals($userId: ID, $makerGroupId: ID, $completed: Boolean, $order: GoalsOrder, $first: Int, $after: String) {
        goals(userId: $userId, makerGroupId: $makerGroupId, completed: $completed, order: $order, first: $first, after: $after) {
          edges {
            cursor
            node {
              id
              title
              dueAt
              completedAt
              isCompleted
              cheersCount
              focusedDuration
              user {
                id
                name
                username
              }
              makerGroup {
                id
                name
              }
            }
          }
          pageInfo {
            hasNextPage
            hasPreviousPage
            startCursor
            endCursor
          }
          totalCount
        }
      }
    `;

    const data = await this.executeGraphQL<{ goals: { edges: Array<{ cursor: string; node: ProductHuntGoal }>; pageInfo: PageInfo; totalCount: number } }>(query, {
      userId: args.userId,
      makerGroupId: args.makerGroupId,
      completed: args.completed,
      order: args.order,
      first: args.first || 10,
      after: args.after,
    });

    return this.formatResponse(data.goals);
  }

  // Maker Group methods
  private async getMakerGroup(id: string): Promise<CallToolResult> {
    const query = `
      query GetMakerGroup($id: ID!) {
        makerGroup(id: $id) {
          id
          name
          tagline
          description
          membersCount
          goalsCount
          createdAt
        }
      }
    `;

    const data = await this.executeGraphQL<{ makerGroup: ProductHuntMakerGroup }>(query, { id });

    return this.formatResponse(data.makerGroup);
  }

  private async getMakerGroups(args: Record<string, any>): Promise<CallToolResult> {
    const query = `
      query GetMakerGroups($userId: ID, $order: MakerGroupsOrder, $first: Int, $after: String) {
        makerGroups(userId: $userId, order: $order, first: $first, after: $after) {
          edges {
            cursor
            node {
              id
              name
              tagline
              description
              membersCount
              goalsCount
              createdAt
            }
          }
          pageInfo {
            hasNextPage
            hasPreviousPage
            startCursor
            endCursor
          }
          totalCount
        }
      }
    `;

    const data = await this.executeGraphQL<{ makerGroups: { edges: Array<{ cursor: string; node: ProductHuntMakerGroup }>; pageInfo: PageInfo; totalCount: number } }>(query, {
      userId: args.userId,
      order: args.order,
      first: args.first || 10,
      after: args.after,
    });

    return this.formatResponse(data.makerGroups);
  }

  // Viewer method (authenticated user)
  private async getViewer(): Promise<CallToolResult> {
    const query = `
      query GetViewer {
        viewer {
          user {
            id
            username
            name
            headline
            profileImage
            isMaker
          }
          goals(first: 5, order: NEWEST) {
            totalCount
            edges {
              node {
                id
                title
                isCompleted
              }
            }
          }
          makerGroups(first: 5) {
            totalCount
            edges {
              node {
                id
                name
              }
            }
          }
        }
      }
    `;

    const data = await this.executeGraphQL<{ viewer: any }>(query);

    return this.formatResponse(data.viewer);
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

const server = new ProductHuntAPIMCPServer();
server.run().catch(console.error);
