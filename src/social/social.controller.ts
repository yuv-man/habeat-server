import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard";
import { SocialService } from "./social.service";
import { CreatePostDto, AddCommentDto } from "./dto";

@ApiTags("Social")
@Controller("social")
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class SocialController {
  constructor(private readonly socialService: SocialService) {}

  // ========== POSTS ==========

  @Post("posts")
  @ApiOperation({ summary: "Create a new shareable post" })
  async createPost(@Req() req: any, @Body() createPostDto: CreatePostDto) {
    return this.socialService.createPost(req.user.userId, createPostDto);
  }

  @Get("posts/feed")
  @ApiOperation({ summary: "Get social feed" })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "limit", required: false, type: Number })
  async getFeed(
    @Req() req: any,
    @Query("page") page?: string,
    @Query("limit") limit?: string
  ) {
    return this.socialService.getFeed(
      req.user.userId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20
    );
  }

  @Get("posts/:id")
  @ApiOperation({ summary: "Get a single post by ID" })
  async getPost(@Req() req: any, @Param("id") postId: string) {
    return this.socialService.getPostById(postId, req.user.userId);
  }

  @Delete("posts/:id")
  @ApiOperation({ summary: "Delete own post" })
  async deletePost(@Req() req: any, @Param("id") postId: string) {
    return this.socialService.deletePost(postId, req.user.userId);
  }

  @Get("users/:userId/posts")
  @ApiOperation({ summary: "Get posts by a specific user" })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "limit", required: false, type: Number })
  async getUserPosts(
    @Req() req: any,
    @Param("userId") targetUserId: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string
  ) {
    return this.socialService.getUserPosts(
      targetUserId,
      req.user.userId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20
    );
  }

  // ========== LIKES ==========

  @Post("posts/:id/like")
  @ApiOperation({ summary: "Like or unlike a post" })
  async toggleLike(@Req() req: any, @Param("id") postId: string) {
    return this.socialService.toggleLike(postId, req.user.userId);
  }

  // ========== COMMENTS ==========

  @Post("posts/:id/comment")
  @ApiOperation({ summary: "Add a comment to a post" })
  async addComment(
    @Req() req: any,
    @Param("id") postId: string,
    @Body() addCommentDto: AddCommentDto
  ) {
    return this.socialService.addComment(postId, req.user.userId, addCommentDto);
  }

  @Delete("posts/:postId/comments/:commentId")
  @ApiOperation({ summary: "Delete a comment" })
  async deleteComment(
    @Req() req: any,
    @Param("postId") postId: string,
    @Param("commentId") commentId: string
  ) {
    return this.socialService.deleteComment(postId, commentId, req.user.userId);
  }

  // ========== FOLLOWS ==========

  @Post("follow/:userId")
  @ApiOperation({ summary: "Follow a user" })
  async follow(@Req() req: any, @Param("userId") userId: string) {
    return this.socialService.follow(req.user.userId, userId);
  }

  @Delete("follow/:userId")
  @ApiOperation({ summary: "Unfollow a user" })
  async unfollow(@Req() req: any, @Param("userId") userId: string) {
    return this.socialService.unfollow(req.user.userId, userId);
  }

  @Get("followers")
  @ApiOperation({ summary: "Get current user's followers" })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "limit", required: false, type: Number })
  async getFollowers(
    @Req() req: any,
    @Query("page") page?: string,
    @Query("limit") limit?: string
  ) {
    return this.socialService.getFollowers(
      req.user.userId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 50
    );
  }

  @Get("following")
  @ApiOperation({ summary: "Get users the current user is following" })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "limit", required: false, type: Number })
  async getFollowing(
    @Req() req: any,
    @Query("page") page?: string,
    @Query("limit") limit?: string
  ) {
    return this.socialService.getFollowing(
      req.user.userId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 50
    );
  }

  @Get("users/:userId/followers")
  @ApiOperation({ summary: "Get followers of a specific user" })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "limit", required: false, type: Number })
  async getUserFollowers(
    @Param("userId") userId: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string
  ) {
    return this.socialService.getFollowers(
      userId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 50
    );
  }

  @Get("users/:userId/following")
  @ApiOperation({ summary: "Get users that a specific user is following" })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "limit", required: false, type: Number })
  async getUserFollowing(
    @Param("userId") userId: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string
  ) {
    return this.socialService.getFollowing(
      userId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 50
    );
  }

  @Get("users/:userId/follow-status")
  @ApiOperation({ summary: "Check if current user is following a user" })
  async getFollowStatus(@Req() req: any, @Param("userId") userId: string) {
    const isFollowing = await this.socialService.isFollowing(req.user.userId, userId);
    const counts = await this.socialService.getFollowCounts(userId);
    return { isFollowing, ...counts };
  }

  @Get("discover/suggested")
  @ApiOperation({ summary: "Get suggested users to follow" })
  @ApiQuery({ name: "limit", required: false, type: Number })
  async getSuggestedUsers(
    @Req() req: any,
    @Query("limit") limit?: string
  ) {
    return this.socialService.getSuggestedUsers(
      req.user.userId,
      limit ? parseInt(limit, 10) : 10
    );
  }

  // ========== SHARE TRACKING ==========

  @Post("posts/:id/share")
  @ApiOperation({ summary: "Track that a post was shared externally" })
  async trackShare(@Param("id") postId: string) {
    return this.socialService.incrementShareCount(postId);
  }
}
