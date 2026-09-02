import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsString, IsNotEmpty, MaxLength } from "class-validator";

/**
 * Validates the login body.
 *
 * The endpoint previously bound `@Body() { email, password }` as an inline
 * type — which class-validator does not run — and passed `email` straight into
 * `userModel.findOne({ email })`. A body like `{ "email": { "$ne": null } }`
 * therefore reached Mongo as a query operator (NoSQL injection) and returned a
 * user. Typing the body as a DTO with @IsEmail forces `email` to be a string,
 * closing that door before the query.
 */
export class LoginDto {
  @ApiProperty({ example: "user@example.com" })
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ example: "••••••••" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  password: string;
}
