import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  Query,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
  ApiQuery,
} from "@nestjs/swagger";
import { ChatService } from "./chat.service";
import { ChatAIService } from "./chat-ai.service";
import { AuthGuard } from "../auth/auth.guard";
import { SendMessageDto } from "./dto/send-message.dto";
import { ActionDecisionDto } from "./dto/action-decision.dto";

@ApiTags("chat")
@Controller("chat")
@UseGuards(AuthGuard)
@ApiBearerAuth("JWT-auth")
export class ChatController {
  constructor(
    private chatService: ChatService,
    private chatAIService: ChatAIService
  ) {}

  @Get(":userId")
  @ApiOperation({ summary: "Get chat history for a user" })
  @ApiParam({ name: "userId", description: "User ID" })
  @ApiQuery({
    name: "limit",
    required: false,
    description: "Number of messages to return (default 30)",
  })
  @ApiResponse({
    status: 200,
    description: "Chat history retrieved successfully",
  })
  async getHistory(
    @Param("userId") userId: string,
    @Query("limit") limit?: number,
    @Request() req?
  ) {
    return this.chatService.getHistory(
      req.user._id.toString(),
      limit ? parseInt(limit.toString()) : 30
    );
  }

  @Post(":userId/message")
  @ApiOperation({
    summary: "Send a message to the nutrition chatbot and get a response",
  })
  @ApiParam({ name: "userId", description: "User ID" })
  @ApiBody({ type: SendMessageDto })
  @ApiResponse({
    status: 200,
    description: "Message sent and response received",
  })
  async sendMessage(
    @Param("userId") userId: string,
    @Body() body: SendMessageDto,
    @Request() req
  ) {
    const actualUserId = req.user._id.toString();

    // Add user message to history
    const userMessage = await this.chatService.addMessage(actualUserId, {
      role: "user",
      content: body.message,
    });

    // Generate AI response
    const aiResponse = await this.chatAIService.generateResponse(
      actualUserId,
      body.message,
      body.context
    );

    // Add assistant message to history
    const assistantMessage = await this.chatService.addMessage(actualUserId, {
      role: "assistant",
      content: aiResponse.message,
      proposedAction: aiResponse.action,
    });

    return {
      success: true,
      data: {
        response: aiResponse.message,
        proposedAction: aiResponse.action
          ? {
              ...aiResponse.action,
              messageId: assistantMessage._id?.toString(),
            }
          : undefined,
        messageId: assistantMessage._id?.toString(),
      },
    };
  }

  @Put(":userId/action/:messageId")
  @ApiOperation({ summary: "Accept or reject a proposed action" })
  @ApiParam({ name: "userId", description: "User ID" })
  @ApiParam({ name: "messageId", description: "Message ID containing the action" })
  @ApiBody({ type: ActionDecisionDto })
  @ApiResponse({
    status: 200,
    description: "Action decision processed",
  })
  async handleActionDecision(
    @Param("userId") userId: string,
    @Param("messageId") messageId: string,
    @Body() body: ActionDecisionDto,
    @Request() req
  ) {
    const actualUserId = req.user._id.toString();

    if (body.decision === "reject") {
      await this.chatService.updateActionStatus(
        actualUserId,
        messageId,
        "rejected"
      );

      return {
        success: true,
        data: {
          message: "Action rejected",
        },
      };
    }

    // Accept and apply the action
    const plan = req.user.plan || (await this.chatAIService.getUserPlan(actualUserId));

    if (!plan) {
      return {
        success: false,
        message: "No meal plan found. Please generate a meal plan first.",
      };
    }

    const result = await this.chatService.applyAction(
      actualUserId,
      messageId,
      plan
    );

    // Add confirmation message from assistant
    await this.chatService.addMessage(actualUserId, {
      role: "assistant",
      content: `Done! ${result.message}`,
    });

    return {
      success: true,
      data: {
        message: result.message,
        plan: result.plan,
      },
    };
  }

  @Delete(":userId")
  @ApiOperation({ summary: "Clear chat history" })
  @ApiParam({ name: "userId", description: "User ID" })
  @ApiResponse({
    status: 200,
    description: "Chat history cleared",
  })
  async clearHistory(@Param("userId") userId: string, @Request() req) {
    return this.chatService.clearHistory(req.user._id.toString());
  }
}
