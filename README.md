# Product Hunt MCP Server

[![npm version](https://badge.fury.io/js/%40yilin-jing%2Fproducthunt-mcp.svg)](https://www.npmjs.com/package/@yilin-jing/producthunt-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An MCP (Model Context Protocol) server that provides access to Product Hunt data through the [Product Hunt API v2](https://api.producthunt.com/v2/docs) (GraphQL).

## Quick Start

```bash
npx @yilin-jing/producthunt-mcp
```

## Features

This MCP server provides comprehensive access to Product Hunt data including:

### Post Operations
- **get_post** - Get a Product Hunt post by ID or slug
- **get_posts** - Get posts with filtering and ordering options
- **search_posts** - Search posts by query

### Collection Operations
- **get_collection** - Get a collection by ID or slug
- **get_collections** - Get collections with filtering options

### User Operations
- **get_user** - Get a user by ID or username
- **get_user_posts** - Get posts made by a specific user
- **get_user_voted_posts** - Get posts upvoted by a specific user

### Topic Operations
- **get_topic** - Get a topic by ID or slug
- **get_topics** - Get topics with filtering options

### Comment Operations
- **get_comment** - Get a comment by ID
- **get_post_comments** - Get comments on a specific post

### Goal Operations
- **get_goal** - Get a maker goal by ID
- **get_goals** - Get maker goals with filtering options

### Maker Group Operations
- **get_maker_group** - Get a maker group (Space) by ID
- **get_maker_groups** - Get maker groups with filtering options

### Viewer Operations
- **get_viewer** - Get the authenticated user information

## Installation

### Using npx (Recommended)

No installation required! Just configure Claude Desktop to use the server directly via npx.

### Global Installation

```bash
npm install -g @yilin-jing/producthunt-mcp
```

### Local Development

```bash
git clone https://github.com/Jing-yilin/producthunt-mcp-server.git
cd producthunt-mcp-server
npm install
npm run build
```

## Configuration

### Environment Variables

| Variable | Description |
|----------|-------------|
| `PRODUCTHUNT_ACCESS_TOKEN` or `PH_ACCESS_TOKEN` | Your Product Hunt API access token (required) |
| `PROXY_URL` | HTTP/HTTPS proxy URL (optional) |

### Getting an Access Token

1. Go to [Product Hunt API Dashboard](https://www.producthunt.com/v2/oauth/applications)
2. Create a new application or use an existing one
3. Generate a Developer Token for simple scripts, or implement OAuth for user-based access

### Claude Desktop Configuration

Add to your Claude Desktop config file:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

#### Using npx (Recommended)

```json
{
  "mcpServers": {
    "producthunt": {
      "command": "npx",
      "args": ["-y", "@yilin-jing/producthunt-mcp"],
      "env": {
        "PRODUCTHUNT_ACCESS_TOKEN": "your-access-token-here"
      }
    }
  }
}
```

#### Using Global Installation

```json
{
  "mcpServers": {
    "producthunt": {
      "command": "producthunt-mcp",
      "env": {
        "PRODUCTHUNT_ACCESS_TOKEN": "your-access-token-here"
      }
    }
  }
}
```

## Usage Examples

### Get Today's Featured Posts

```
Get the featured posts from Product Hunt today
```

### Get a Specific Product

```
Get the Product Hunt post for "ChatGPT"
```

### Get User Information

```
Get the Product Hunt profile for username "rrhoover"
```

### Get Posts by Topic

```
Get the latest AI products on Product Hunt
```

### Get Collections

```
Get the featured collections on Product Hunt
```

## API Reference

### Post Endpoints

#### get_post
Get a Product Hunt post by ID or slug.

Parameters:
- `id` (string, optional): Post ID
- `slug` (string, optional): Post slug

#### get_posts
Get posts with filtering and ordering.

Parameters:
- `featured` (boolean, optional): Filter by featured posts only
- `topic` (string, optional): Filter by topic slug
- `postedAfter` (string, optional): Filter posts after this date (ISO 8601)
- `postedBefore` (string, optional): Filter posts before this date (ISO 8601)
- `order` (string, optional): Order by 'FEATURED_AT', 'NEWEST', 'RANKING', 'VOTES'
- `first` (integer, optional): Number of posts to return (default: 10, max: 20)
- `after` (string, optional): Cursor for pagination

#### search_posts
Search posts by query.

Parameters:
- `query` (string, required): Search query
- `first` (integer, optional): Number of posts to return
- `after` (string, optional): Cursor for pagination

### Collection Endpoints

#### get_collection
Get a collection by ID or slug.

Parameters:
- `id` (string, optional): Collection ID
- `slug` (string, optional): Collection slug

#### get_collections
Get collections with filtering.

Parameters:
- `featured` (boolean, optional): Filter by featured collections
- `userId` (string, optional): Filter by user ID
- `postId` (string, optional): Filter by post ID
- `order` (string, optional): Order by 'FEATURED_AT', 'FOLLOWERS_COUNT', 'NEWEST'
- `first` (integer, optional): Number of collections to return
- `after` (string, optional): Cursor for pagination

### User Endpoints

#### get_user
Get a user by ID or username.

Parameters:
- `id` (string, optional): User ID
- `username` (string, optional): Username

#### get_user_posts
Get posts made by a user.

Parameters:
- `username` (string, required): Username
- `first` (integer, optional): Number of posts to return
- `after` (string, optional): Cursor for pagination

#### get_user_voted_posts
Get posts upvoted by a user.

Parameters:
- `username` (string, required): Username
- `first` (integer, optional): Number of posts to return
- `after` (string, optional): Cursor for pagination

### Topic Endpoints

#### get_topic
Get a topic by ID or slug.

Parameters:
- `id` (string, optional): Topic ID
- `slug` (string, optional): Topic slug

#### get_topics
Get topics with filtering.

Parameters:
- `search` (string, optional): Search topics by name
- `order` (string, optional): Order by 'FOLLOWERS_COUNT', 'NEWEST'
- `first` (integer, optional): Number of topics to return
- `after` (string, optional): Cursor for pagination

### Comment Endpoints

#### get_comment
Get a comment by ID.

Parameters:
- `id` (string, required): Comment ID

#### get_post_comments
Get comments on a post.

Parameters:
- `postId` (string, optional): Post ID
- `postSlug` (string, optional): Post slug
- `order` (string, optional): Order by 'NEWEST', 'VOTES_COUNT'
- `first` (integer, optional): Number of comments to return
- `after` (string, optional): Cursor for pagination

### Goal Endpoints

#### get_goal
Get a maker goal by ID.

Parameters:
- `id` (string, required): Goal ID

#### get_goals
Get maker goals with filtering.

Parameters:
- `userId` (string, optional): Filter by user ID
- `makerGroupId` (string, optional): Filter by maker group ID
- `completed` (boolean, optional): Filter by completion status
- `order` (string, optional): Order by 'COMPLETED_AT', 'DUE_AT', 'NEWEST'
- `first` (integer, optional): Number of goals to return
- `after` (string, optional): Cursor for pagination

### Maker Group Endpoints

#### get_maker_group
Get a maker group (Space) by ID.

Parameters:
- `id` (string, required): Maker Group ID

#### get_maker_groups
Get maker groups with filtering.

Parameters:
- `userId` (string, optional): Filter by user ID
- `order` (string, optional): Order by 'GOALS_COUNT', 'LAST_ACTIVE', 'MEMBERS_COUNT', 'NEWEST'
- `first` (integer, optional): Number of groups to return
- `after` (string, optional): Cursor for pagination

### Viewer Endpoints

#### get_viewer
Get the authenticated user information and their data.

No parameters required.

## Pagination

All list endpoints support cursor-based pagination using the `after` parameter. The response includes a `pageInfo` object with:

- `hasNextPage` (boolean): Whether there are more results
- `hasPreviousPage` (boolean): Whether there are previous results
- `startCursor` (string): Cursor for the first item
- `endCursor` (string): Cursor for the last item (use this for the `after` parameter)

## Rate Limits

The Product Hunt API has rate limits. Please refer to the [official documentation](https://api.producthunt.com/v2/docs) for current limits.

## Publishing

To publish a new version to npm:

```bash
npm version patch  # or minor, major
npm publish
```

## License

MIT

## Credits

- Uses [Product Hunt API v2](https://api.producthunt.com/v2/docs) (GraphQL)
- Built with [Model Context Protocol SDK](https://github.com/anthropics/mcp)
