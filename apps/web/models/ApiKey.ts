import mongoose from "mongoose";

export interface IApiKey extends mongoose.Document {
  key: string;
  name: string;
  createdAt: Date;
}

const apiKeySchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const ApiKey: mongoose.Model<IApiKey> =
  mongoose.models.ApiKey || mongoose.model<IApiKey>("ApiKey", apiKeySchema);

export default ApiKey;
