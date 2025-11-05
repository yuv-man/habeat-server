// open db connection

import mongoose from "mongoose";

export const model = mongoose.model;
export const ObjectId = mongoose.Schema.Types.ObjectId;

// open db connection
export const openDbConnection = async () => {
  const uri = process.env.MONGO_URL_LOCAL;
  if (!uri) {
    throw new Error("MONGO_URL is not defined");
  }
  return mongoose.connect(uri, {
    dbName: "habeat",
  });
};

// base schema
export const BaseSchema = <T>(fields: any) => {
  return new mongoose.Schema<T>(fields, {
    timestamps: true,
    versionKey: false,
  });
};
