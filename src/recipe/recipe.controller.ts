import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
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
  ApiQuery,
  ApiBody,
} from "@nestjs/swagger";
import { RecipeService } from "./recipe.service";
import { AuthGuard } from "../auth/auth.guard";
import { isAdminRole } from "../enums/enumSubscription";
import { resolveOwnUserId } from "../utils/ownership";

/** Recipes are shared across users (see recipe-signature.ts): an edit or a
 *  delete changes the recipe for everyone who has that dish. */
const requireAdmin = (req: any) => {
  if (!isAdminRole(req.user?.role)) throw new ForbiddenException("Admins only");
};

@ApiTags("recipes")
@Controller("recipes")
export class RecipeController {
  constructor(private recipeService: RecipeService) {}

  @Get()
  @ApiOperation({ summary: "Get all recipes" })
  @ApiQuery({
    name: "category",
    required: false,
    enum: ["breakfast", "lunch", "dinner", "snack"],
  })
  @ApiQuery({ name: "language", required: false, example: "en" })
  @ApiResponse({ status: 200, description: "Recipes retrieved successfully" })
  findAll(
    @Query("category") category?: string,
    @Query("language") language?: string
  ) {
    return this.recipeService.findAll({ category, language });
  }

  @Get("popular")
  @ApiOperation({ summary: "Get popular recipes" })
  @ApiQuery({ name: "limit", required: false, example: 10 })
  @ApiQuery({
    name: "category",
    required: false,
    enum: ["breakfast", "lunch", "dinner", "snack"],
  })
  @ApiResponse({
    status: 200,
    description: "Popular recipes retrieved successfully",
  })
  getPopular(
    @Query("limit") limit?: number,
    @Query("category") category?: string
  ) {
    return this.recipeService.getPopular(limit || 10, category);
  }

  @Get("search")
  @ApiOperation({ summary: "Search recipes" })
  @ApiQuery({ name: "q", required: true, description: "Search query" })
  @ApiQuery({
    name: "category",
    required: false,
    enum: ["breakfast", "lunch", "dinner", "snack"],
  })
  @ApiQuery({ name: "language", required: false, example: "en" })
  @ApiResponse({
    status: 200,
    description: "Search results retrieved successfully",
  })
  search(
    @Query("q") query: string,
    @Query("category") category?: string,
    @Query("language") language?: string
  ) {
    return this.recipeService.search(query, { category, language });
  }

  @Get(":userId/meal/:mealId")
  @UseGuards(AuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({ summary: "Get (or generate) the recipe for a meal in the caller's plan" })
  @ApiParam({ name: "mealId", description: "ID of the meal" })
  @ApiQuery({ name: "language", required: false, example: "en" })
  @ApiResponse({ status: 200, description: "Recipe retrieved successfully" })
  @ApiResponse({ status: 403, description: "userId is not the caller" })
  findByMealId(
    @Request() req: any,
    @Param("userId") userId: string,
    @Param("mealId") mealId: string,
    @Query("language") language?: string
  ) {
    // The user comes from the token, never the URL. This used to be open:
    // anyone could read meals out of another user's plan, and every unknown
    // meal id cost an AI generation. The path keeps `:userId` so existing
    // clients don't break, but it must name the caller.
    return this.recipeService.findByMealId(
      mealId,
      resolveOwnUserId(req, userId),
      language
    );
  }

  @Get(":id")
  @ApiOperation({ summary: "Get recipe by ID" })
  @ApiParam({ name: "id", description: "Recipe ID" })
  @ApiResponse({ status: 200, description: "Recipe retrieved successfully" })
  @ApiResponse({ status: 404, description: "Recipe not found" })
  findById(@Param("id") id: string) {
    return this.recipeService.findById(id);
  }

  @Post()
  @UseGuards(AuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({ summary: "Create a new recipe (admins only)" })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        mealName: { type: "string", example: "Grilled Chicken Salad" },
        title: {
          type: "string",
          example: "Mediterranean Grilled Chicken Salad",
        },
        category: {
          type: "string",
          enum: ["breakfast", "lunch", "dinner", "snack"],
        },
        servings: { type: "number", example: 2 },
        prepTime: { type: "number", example: 15 },
        cookTime: { type: "number", example: 20 },
        nutrition: {
          type: "object",
          properties: {
            calories: { type: "number", example: 450 },
            protein: { type: "number", example: 35 },
            carbs: { type: "number", example: 20 },
            fat: { type: "number", example: 25 },
          },
        },
        ingredients: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              amount: { type: "string" },
              unit: { type: "string" },
            },
          },
        },
        instructions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              step: { type: "number" },
              instruction: { type: "string" },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: "Recipe created successfully" })
  create(@Request() req: any, @Body() recipeData: any) {
    requireAdmin(req);
    return this.recipeService.create(recipeData);
  }

  @Put(":id")
  @UseGuards(AuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({ summary: "Update a recipe (admins only)" })
  @ApiParam({ name: "id", description: "Recipe ID" })
  @ApiResponse({ status: 200, description: "Recipe updated successfully" })
  @ApiResponse({ status: 404, description: "Recipe not found" })
  update(@Request() req: any, @Param("id") id: string, @Body() updateData: any) {
    requireAdmin(req);
    return this.recipeService.update(id, updateData);
  }

  @Delete(":id")
  @UseGuards(AuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({ summary: "Delete a recipe (admins only)" })
  @ApiParam({ name: "id", description: "Recipe ID" })
  @ApiResponse({ status: 200, description: "Recipe deleted successfully" })
  @ApiResponse({ status: 404, description: "Recipe not found" })
  delete(@Request() req: any, @Param("id") id: string) {
    requireAdmin(req);
    return this.recipeService.delete(id);
  }
}
