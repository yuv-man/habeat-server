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
import generateToken from "../utils/generateToken";

@ApiTags("users")
@Controller("users")
export class UserController {
  constructor(private userService: UserService) {}

  @Get()
  findAll() {
    return this.userService.findAll();
  }

  @Post()
  create(@Body() userData: any) {
    return this.userService.create(userData);
  }

  @Post("search")
  search(@Body() searchCriteria: any) {
    return this.userService.search(searchCriteria);
  }

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
      data: {
        user,
        token: generateToken(userId),
      },
    };
  }

  @Get(":id")
  findById(@Param("id") id: string) {
    return this.userService.findById(id);
  }

  @Put(":id")
  update(@Param("id") id: string, @Body() updateData: any) {
    return this.userService.update(id, updateData);
  }

  @Delete(":id")
  delete(@Param("id") id: string) {
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
