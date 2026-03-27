import { Injectable, NotFoundException, ForbiddenException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { SocialPost, PostVisibility } from "./schemas/social-post.schema";
import { Follow } from "./schemas/follow.schema";
import { User } from "../user/user.model";
import { CreatePostDto, AddCommentDto } from "./dto";

/** Populated lean doc; Model<any> makes .lean() infer doc | doc[] without this. */
type LeanPopulatedSocialPost = {
  visibility: PostVisibility;
  userId: { _id: Types.ObjectId };
  likes?: Types.ObjectId[];
  comments?: Array<Record<string, unknown>>;
} & Record<string, unknown>;

@Injectable()
export class SocialService {
  constructor(
    @InjectModel(SocialPost.name) private socialPostModel: Model<any>,
    @InjectModel(Follow.name) private followModel: Model<any>,
    @InjectModel(User.name) private userModel: Model<any>
  ) {}

  // ========== POSTS ==========

  async createPost(userId: string, createPostDto: CreatePostDto) {
    const post = new this.socialPostModel({
      userId: new Types.ObjectId(userId),
      ...createPostDto,
    });
    await post.save();
    return this.getPostById(post._id.toString(), userId);
  }

  async getPostById(postId: string, requestingUserId?: string) {
    const post = await this.socialPostModel
      .findById(postId)
      .populate("userId", "name profilePicture")
      .populate("comments.userId", "name profilePicture")
      .lean();

    if (!post) {
      throw new NotFoundException("Post not found");
    }

    const p = post as unknown as LeanPopulatedSocialPost;

    // Check visibility
    if (p.visibility === PostVisibility.PRIVATE) {
      if (!requestingUserId || p.userId._id.toString() !== requestingUserId) {
        throw new ForbiddenException("This post is private");
      }
    }

    if (p.visibility === PostVisibility.FRIENDS && requestingUserId) {
      const isFollowing = await this.isFollowing(requestingUserId, p.userId._id.toString());
      const isOwner = p.userId._id.toString() === requestingUserId;
      if (!isFollowing && !isOwner) {
        throw new ForbiddenException("This post is only visible to friends");
      }
    }

    return {
      ...post,
      likesCount: p.likes?.length || 0,
      commentsCount: p.comments?.length || 0,
      isLiked: requestingUserId ? p.likes?.some((id: any) => id.toString() === requestingUserId) : false,
    };
  }

  async getFeed(userId: string, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    // Get users that the current user follows
    const following = await this.followModel.find({ followerId: new Types.ObjectId(userId) }).lean();
    const followingIds = following.map((f: any) => f.followingId);

    // Include own posts and posts from followed users (public and friends visibility)
    const posts = await this.socialPostModel
      .find({
        $or: [
          { userId: new Types.ObjectId(userId) },
          {
            userId: { $in: followingIds },
            visibility: { $in: [PostVisibility.PUBLIC, PostVisibility.FRIENDS] },
          },
          { visibility: PostVisibility.PUBLIC },
        ],
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("userId", "name profilePicture")
      .lean();

    const total = await this.socialPostModel.countDocuments({
      $or: [
        { userId: new Types.ObjectId(userId) },
        {
          userId: { $in: followingIds },
          visibility: { $in: [PostVisibility.PUBLIC, PostVisibility.FRIENDS] },
        },
        { visibility: PostVisibility.PUBLIC },
      ],
    });

    return {
      posts: posts.map((post: any) => ({
        ...post,
        likesCount: post.likes?.length || 0,
        commentsCount: post.comments?.length || 0,
        isLiked: post.likes?.some((id: any) => id.toString() === userId),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getUserPosts(targetUserId: string, requestingUserId?: string, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;
    const isOwner = requestingUserId === targetUserId;
    const isFollowing = requestingUserId ? await this.isFollowing(requestingUserId, targetUserId) : false;

    // Determine visibility filter
    let visibilityFilter: any = { visibility: PostVisibility.PUBLIC };
    if (isOwner) {
      visibilityFilter = {}; // Owner can see all their posts
    } else if (isFollowing) {
      visibilityFilter = { visibility: { $in: [PostVisibility.PUBLIC, PostVisibility.FRIENDS] } };
    }

    const posts = await this.socialPostModel
      .find({
        userId: new Types.ObjectId(targetUserId),
        ...visibilityFilter,
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("userId", "name profilePicture")
      .lean();

    const total = await this.socialPostModel.countDocuments({
      userId: new Types.ObjectId(targetUserId),
      ...visibilityFilter,
    });

    return {
      posts: posts.map((post: any) => ({
        ...post,
        likesCount: post.likes?.length || 0,
        commentsCount: post.comments?.length || 0,
        isLiked: requestingUserId ? post.likes?.some((id: any) => id.toString() === requestingUserId) : false,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async deletePost(postId: string, userId: string) {
    const post = await this.socialPostModel.findById(postId);
    if (!post) {
      throw new NotFoundException("Post not found");
    }
    if (post.userId.toString() !== userId) {
      throw new ForbiddenException("You can only delete your own posts");
    }
    await this.socialPostModel.deleteOne({ _id: postId });
    return { success: true };
  }

  // ========== LIKES ==========

  async toggleLike(postId: string, userId: string) {
    const post = await this.socialPostModel.findById(postId);
    if (!post) {
      throw new NotFoundException("Post not found");
    }

    const userObjectId = new Types.ObjectId(userId);
    const isLiked = post.likes.some((id: any) => id.toString() === userId);

    if (isLiked) {
      post.likes = post.likes.filter((id: any) => id.toString() !== userId);
    } else {
      post.likes.push(userObjectId);
    }

    await post.save();
    return {
      isLiked: !isLiked,
      likesCount: post.likes.length,
    };
  }

  // ========== COMMENTS ==========

  async addComment(postId: string, userId: string, addCommentDto: AddCommentDto) {
    const post = await this.socialPostModel.findById(postId);
    if (!post) {
      throw new NotFoundException("Post not found");
    }

    const comment = {
      userId: new Types.ObjectId(userId),
      text: addCommentDto.text,
      createdAt: new Date(),
    };

    post.comments.push(comment);
    await post.save();

    // Return populated comment
    const updatedPost = await this.socialPostModel
      .findById(postId)
      .populate("comments.userId", "name profilePicture")
      .lean();

    if (!updatedPost) {
      throw new NotFoundException("Post not found");
    }

    const u = updatedPost as unknown as LeanPopulatedSocialPost & {
      comments: Array<Record<string, unknown>>;
    };
    return u.comments[u.comments.length - 1];
  }

  async deleteComment(postId: string, commentId: string, userId: string) {
    const post = await this.socialPostModel.findById(postId);
    if (!post) {
      throw new NotFoundException("Post not found");
    }

    const commentIndex = post.comments.findIndex(
      (c: any) => c._id.toString() === commentId
    );

    if (commentIndex === -1) {
      throw new NotFoundException("Comment not found");
    }

    const comment = post.comments[commentIndex];
    const isCommentOwner = comment.userId.toString() === userId;
    const isPostOwner = post.userId.toString() === userId;

    if (!isCommentOwner && !isPostOwner) {
      throw new ForbiddenException("You can only delete your own comments");
    }

    post.comments.splice(commentIndex, 1);
    await post.save();

    return { success: true };
  }

  // ========== FOLLOWS ==========

  async follow(followerId: string, followingId: string) {
    if (followerId === followingId) {
      throw new ForbiddenException("You cannot follow yourself");
    }

    const existingFollow = await this.followModel.findOne({
      followerId: new Types.ObjectId(followerId),
      followingId: new Types.ObjectId(followingId),
    });

    if (existingFollow) {
      return { alreadyFollowing: true };
    }

    const follow = new this.followModel({
      followerId: new Types.ObjectId(followerId),
      followingId: new Types.ObjectId(followingId),
    });

    await follow.save();
    return { success: true };
  }

  async unfollow(followerId: string, followingId: string) {
    const result = await this.followModel.deleteOne({
      followerId: new Types.ObjectId(followerId),
      followingId: new Types.ObjectId(followingId),
    });

    if (result.deletedCount === 0) {
      throw new NotFoundException("Follow relationship not found");
    }

    return { success: true };
  }

  async getFollowers(userId: string, page: number = 1, limit: number = 50) {
    const skip = (page - 1) * limit;

    const followers = await this.followModel
      .find({ followingId: new Types.ObjectId(userId) })
      .skip(skip)
      .limit(limit)
      .populate("followerId", "name profilePicture")
      .lean();

    const total = await this.followModel.countDocuments({
      followingId: new Types.ObjectId(userId),
    });

    return {
      users: followers.map((f: any) => f.followerId),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getFollowing(userId: string, page: number = 1, limit: number = 50) {
    const skip = (page - 1) * limit;

    const following = await this.followModel
      .find({ followerId: new Types.ObjectId(userId) })
      .skip(skip)
      .limit(limit)
      .populate("followingId", "name profilePicture")
      .lean();

    const total = await this.followModel.countDocuments({
      followerId: new Types.ObjectId(userId),
    });

    return {
      users: following.map((f: any) => f.followingId),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async isFollowing(followerId: string, followingId: string): Promise<boolean> {
    const follow = await this.followModel.findOne({
      followerId: new Types.ObjectId(followerId),
      followingId: new Types.ObjectId(followingId),
    });
    return !!follow;
  }

  async getFollowCounts(userId: string) {
    const [followersCount, followingCount] = await Promise.all([
      this.followModel.countDocuments({ followingId: new Types.ObjectId(userId) }),
      this.followModel.countDocuments({ followerId: new Types.ObjectId(userId) }),
    ]);

    return { followersCount, followingCount };
  }

  // ========== DISCOVERY ==========

  async getSuggestedUsers(userId: string, limit: number = 10) {
    const userObjectId = new Types.ObjectId(userId);

    // Get users the current user already follows
    const following = await this.followModel
      .find({ followerId: userObjectId })
      .lean();
    const followingIds = following.map((f: any) => f.followingId.toString());

    // Get users who follow the current user (potential follow-backs)
    const followers = await this.followModel
      .find({ followingId: userObjectId })
      .populate("followerId", "name profilePicture")
      .lean();

    const followBackSuggestions = followers
      .filter((f: any) => !followingIds.includes(f.followerId._id.toString()))
      .map((f: any) => ({
        ...f.followerId,
        reason: "Follows you",
      }));

    // Get popular users (most followers) that user doesn't follow
    const popularUsersAggregation = await this.followModel.aggregate([
      {
        $group: {
          _id: "$followingId",
          followerCount: { $sum: 1 },
        },
      },
      {
        $match: {
          _id: {
            $nin: [...followingIds.map(id => new Types.ObjectId(id)), userObjectId]
          },
        },
      },
      { $sort: { followerCount: -1 } },
      { $limit: limit },
    ]);

    const popularUserIds = popularUsersAggregation.map((u: any) => u._id);
    const popularUsers = await this.userModel
      .find({ _id: { $in: popularUserIds } })
      .select("name profilePicture")
      .lean();

    const popularUsersWithCount = popularUsers.map((user: any) => {
      const aggData = popularUsersAggregation.find(
        (a: any) => a._id.toString() === user._id.toString()
      );
      return {
        ...user,
        followerCount: aggData?.followerCount || 0,
        reason: "Popular",
      };
    });

    // Get active users (posted recently) that user doesn't follow
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const activePostersAggregation = await this.socialPostModel.aggregate([
      {
        $match: {
          createdAt: { $gte: sevenDaysAgo },
          visibility: PostVisibility.PUBLIC,
          userId: {
            $nin: [...followingIds.map(id => new Types.ObjectId(id)), userObjectId]
          },
        },
      },
      {
        $group: {
          _id: "$userId",
          postCount: { $sum: 1 },
        },
      },
      { $sort: { postCount: -1 } },
      { $limit: limit },
    ]);

    const activeUserIds = activePostersAggregation.map((u: any) => u._id);
    const activeUsers = await this.userModel
      .find({ _id: { $in: activeUserIds } })
      .select("name profilePicture")
      .lean();

    const activeUsersWithReason = activeUsers.map((user: any) => ({
      ...user,
      reason: "Active",
    }));

    // Combine and deduplicate suggestions
    const allSuggestions = [
      ...followBackSuggestions,
      ...popularUsersWithCount,
      ...activeUsersWithReason,
    ];

    const seenIds = new Set<string>();
    const uniqueSuggestions = allSuggestions.filter((user: any) => {
      const id = user._id.toString();
      if (seenIds.has(id)) return false;
      seenIds.add(id);
      return true;
    });

    return {
      users: uniqueSuggestions.slice(0, limit),
    };
  }

  // ========== SHARE TRACKING ==========

  async incrementShareCount(postId: string) {
    const post = await this.socialPostModel.findByIdAndUpdate(
      postId,
      { $inc: { shares: 1 } },
      { new: true }
    );

    if (!post) {
      throw new NotFoundException("Post not found");
    }

    return { shares: post.shares };
  }
}
