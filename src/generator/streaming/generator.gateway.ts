import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { Injectable, UseGuards } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import logger from "../../utils/logger";
import { StreamingGeneratorService } from "./streaming.service";
import { UserService } from "../../user/user.service";
import {
  SOCKET_EVENTS,
  GeneratePlanRequest,
  PlanErrorPayload,
} from "./streaming.types";

/**
 * WebSocket Gateway for streaming meal plan generation
 *
 * Provides real-time updates during plan generation:
 * 1. Skeleton (meal names) - sent immediately (~5-8s)
 * 2. Progress updates - sent as details are filled in
 * 3. Complete plan - sent when fully generated
 *
 * Connection: ws://server/generator
 * Authentication: Pass JWT token in handshake auth or query
 */
@WebSocketGateway({
  namespace: "/generator",
  cors: {
    origin: "*", // Configure based on your needs
    credentials: true,
  },
  transports: ["websocket", "polling"],
})
@Injectable()
export class GeneratorGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  // Track active connections and their generations
  private userSockets: Map<string, Set<string>> = new Map(); // userId -> Set<socketId>
  private socketUsers: Map<string, string> = new Map(); // socketId -> userId
  private activeGenerations: Map<string, string> = new Map(); // socketId -> generationId

  constructor(
    private readonly streamingService: StreamingGeneratorService,
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Handle new WebSocket connection
   * Authenticates the user via JWT token
   */
  async handleConnection(client: Socket) {
    try {
      // Get token from handshake auth or query
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace("Bearer ", "") ||
        (client.handshake.query?.token as string);

      if (!token) {
        logger.warn(`[WS] Connection rejected: No token provided`);
        client.emit(SOCKET_EVENTS.AUTH_ERROR, { error: "Authentication required" });
        client.disconnect();
        return;
      }

      // Verify JWT
      const decoded = this.jwtService.verify(token, {
        secret: process.env.JWT_SECRET,
      });

      const userId = decoded.sub || decoded.userId;
      if (!userId) {
        logger.warn(`[WS] Connection rejected: Invalid token payload`);
        client.emit(SOCKET_EVENTS.AUTH_ERROR, { error: "Invalid token" });
        client.disconnect();
        return;
      }

      // Store socket-user mapping
      this.socketUsers.set(client.id, userId);
      if (!this.userSockets.has(userId)) {
        this.userSockets.set(userId, new Set());
      }
      this.userSockets.get(userId)!.add(client.id);

      // Join user-specific room
      client.join(`user:${userId}`);

      logger.info(`[WS] Client connected: ${client.id} (user: ${userId})`);
      client.emit(SOCKET_EVENTS.AUTHENTICATED, { userId, socketId: client.id });

    } catch (error) {
      logger.error(`[WS] Connection error: ${error.message}`);
      client.emit(SOCKET_EVENTS.AUTH_ERROR, { error: "Authentication failed" });
      client.disconnect();
    }
  }

  /**
   * Handle WebSocket disconnection
   */
  handleDisconnect(client: Socket) {
    const userId = this.socketUsers.get(client.id);
    if (userId) {
      this.userSockets.get(userId)?.delete(client.id);
      if (this.userSockets.get(userId)?.size === 0) {
        this.userSockets.delete(userId);
      }
    }
    this.socketUsers.delete(client.id);

    // Cancel any active generation for this socket
    const generationId = this.activeGenerations.get(client.id);
    if (generationId) {
      this.streamingService.cancelGeneration(generationId);
      this.activeGenerations.delete(client.id);
    }

    logger.info(`[WS] Client disconnected: ${client.id}`);
  }

  /**
   * Handle plan generation request
   */
  @SubscribeMessage(SOCKET_EVENTS.GENERATE_PLAN)
  async handleGeneratePlan(
    @ConnectedSocket() client: Socket,
    @MessageBody() request: GeneratePlanRequest,
  ) {
    const userId = this.socketUsers.get(client.id);
    if (!userId) {
      client.emit(SOCKET_EVENTS.PLAN_ERROR, {
        status: "error",
        error: "Not authenticated",
        recoverable: false,
      } as PlanErrorPayload);
      return;
    }

    // Check if there's already an active generation for this socket
    if (this.activeGenerations.has(client.id)) {
      client.emit(SOCKET_EVENTS.PLAN_ERROR, {
        status: "error",
        error: "Generation already in progress. Cancel it first.",
        recoverable: true,
      } as PlanErrorPayload);
      return;
    }

    try {
      // Get user data
      const user = await this.userService.findById(userId);
      if (!user) {
        client.emit(SOCKET_EVENTS.PLAN_ERROR, {
          status: "error",
          error: "User not found",
          recoverable: false,
        } as PlanErrorPayload);
        return;
      }

      // Convert user to IUserData format (cast to any to satisfy interface)
      const userData = {
        age: user.age,
        gender: user.gender,
        height: user.height,
        weight: user.weight,
        path: user.path,
        workoutFrequency: user.workoutFrequency,
        allergies: user.allergies || [],
        dietaryRestrictions: user.dietaryRestrictions || [],
        dislikes: user.dislikes || [],
        foodPreferences: user.foodPreferences || [],
        favoriteMeals: user.favoriteMeals || [],
        // Minimal required fields for IUserData (not used in generation)
        email: user.email || "",
        password: "",
        name: user.name || "",
        preferences: user.preferences || {},
      } as any;

      // Generate unique ID for this generation
      const generationId = `${userId}-${Date.now()}`;
      this.activeGenerations.set(client.id, generationId);

      logger.info(`[WS] Starting generation ${generationId} for user ${userId}`);

      // Start streaming generation
      await this.streamingService.generateWithStreaming(
        userData,
        {
          onSkeleton: (payload) => {
            client.emit(SOCKET_EVENTS.PLAN_SKELETON, payload);
          },
          onProgress: (payload) => {
            client.emit(SOCKET_EVENTS.PLAN_PROGRESS, payload);
          },
          onComplete: (payload) => {
            this.activeGenerations.delete(client.id);
            client.emit(SOCKET_EVENTS.PLAN_COMPLETE, payload);
          },
          onError: (error, phase, recoverable, partialData) => {
            this.activeGenerations.delete(client.id);
            client.emit(SOCKET_EVENTS.PLAN_ERROR, {
              status: "error",
              error,
              phase,
              recoverable,
              partialData,
            } as PlanErrorPayload);
          },
        },
        {
          generationId,
          weekStartDate: request.weekStartDate ? new Date(request.weekStartDate) : undefined,
          planType: request.planType,
          language: request.language,
          goals: request.goals,
          planTemplate: request.planTemplate,
        },
      );

    } catch (error) {
      this.activeGenerations.delete(client.id);
      logger.error(`[WS] Generation error: ${error.message}`);
      client.emit(SOCKET_EVENTS.PLAN_ERROR, {
        status: "error",
        error: error.message || "Generation failed",
        recoverable: false,
      } as PlanErrorPayload);
    }
  }

  /**
   * Handle generation cancellation
   */
  @SubscribeMessage(SOCKET_EVENTS.CANCEL_GENERATION)
  handleCancelGeneration(@ConnectedSocket() client: Socket) {
    const generationId = this.activeGenerations.get(client.id);
    if (generationId) {
      const cancelled = this.streamingService.cancelGeneration(generationId);
      this.activeGenerations.delete(client.id);
      logger.info(`[WS] Generation ${generationId} cancelled: ${cancelled}`);
      return { cancelled };
    }
    return { cancelled: false, reason: "No active generation" };
  }

  /**
   * Get all connected sockets for a user (for broadcasting)
   */
  getUserSockets(userId: string): string[] {
    return Array.from(this.userSockets.get(userId) || []);
  }

  /**
   * Broadcast to all sockets of a specific user
   */
  broadcastToUser(userId: string, event: string, payload: any) {
    this.server.to(`user:${userId}`).emit(event, payload);
  }
}
