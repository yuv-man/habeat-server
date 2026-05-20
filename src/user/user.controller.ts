import {
  Controller,
  Get,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  ForbiddenException,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
} from "@nestjs/swagger";
import { UserService } from "./user.service";
import { AuthGuard } from "../auth/auth.guard";

@ApiTags("users")
@Controller("users")
export class UserController {
  constructor(private userService: UserService) {}

  @Get("me")
  @UseGuards(AuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({ summary: "Get current user information" })
  @ApiResponse({
    status: 200,
    description: "User information retrieved successfully",
  })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async getCurrentUser(@Request() req) {
    const userId = req.user._id.toString();
    const user = await this.userService.findById(userId);
    return {
      status: "success",
      data: { user },
    };
  }

  @Get(":id")
  @UseGuards(AuthGuard)
  @ApiBearerAuth("JWT-auth")
  findById(@Param("id") id: string, @Request() req) {
    const requesterId = req.user._id.toString();
    if (requesterId !== id) {
      throw new ForbiddenException("Access denied");
    }
    return this.userService.findById(id);
  }

  @Put(":id")
  @UseGuards(AuthGuard)
  @ApiBearerAuth("JWT-auth")
  update(@Param("id") id: string, @Body() updateData: any, @Request() req) {
    const requesterId = req.user._id.toString();
    if (requesterId !== id) {
      throw new ForbiddenException("Access denied");
    }
    return this.userService.update(id, updateData);
  }

  @Delete(":id")
  @UseGuards(AuthGuard)
  @ApiBearerAuth("JWT-auth")
  delete(@Param("id") id: string, @Request() req) {
    const requesterId = req.user._id.toString();
    if (requesterId !== id) {
      throw new ForbiddenException("Access denied");
    }
    return this.userService.delete(id);
  }

  @Get(":userId/favorite-meals")
  @UseGuards(AuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Get user favorite meals (actual meals user has favorited)",
  })
  @ApiParam({ name: "userId", description: "User ID or 'me' for current user" })
  @ApiResponse({
    status: 200,
    description: "Favorite meals retrieved successfully",
  })
  @ApiResponse({ status: 404, description: "User not found" })
  getUserFavoriteMeals(@Param("userId") userId: string, @Request() req) {
    const resolvedUserId = userId === "me" ? req.user._id.toString() : userId;
    return this.userService.getUserFavoriteMeals(resolvedUserId);
  }

  @Put(":userId/favorite-meals")
  @UseGuards(AuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({ summary: "Add or remove a meal from favorites" })
  @ApiParam({ name: "userId", description: "User ID or 'me' for current user" })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        isFavorite: { type: "boolean", example: true },
        mealId: { type: "string", example: "507f1f77bcf86cd799439011" },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: "Favorite meals updated successfully",
  })
  @ApiResponse({ status: 404, description: "User or meal not found" })
  updateUserFavoriteMeals(
    @Param("userId") userId: string,
    @Body() body: { isFavorite: boolean; mealId: string },
    @Request() req
  ) {
    const resolvedUserId = userId === "me" ? req.user._id.toString() : userId;
    return this.userService.updateUserFavoriteMeals(
      resolvedUserId,
      body.isFavorite,
      body.mealId
    );
  }
}
