import mongoose, { type Document, Schema } from "mongoose";

export interface ILink extends Document {
  label: string;
  url: string;
  icon: "external" | "github" | "notepad";
}

export interface ISourceRepository {
  provider: "github";
  owner: string;
  repo: string;
  url: string;
  branch?: string;
}

export interface IProject extends Document {
  title: string;
  subtitle: string;
  images: string[];
  media?: string[];
  links: ILink[];
  sourceRepository?: ISourceRepository;
  markdown: string;
  tags: string[];
  isActive: boolean;
  isFeatured: boolean;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanProject {
  _id: string;
  title: string;
  subtitle: string;
  images: string[];
  media?: string[];
  links: {
    _id: string;
    label: string;
    url: string;
    icon: "external" | "github" | "notepad";
  }[];
  sourceRepository?: ISourceRepository;
  markdown: string;
  tags: string[];
  isActive: boolean;
  isFeatured: boolean;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

export const LinkSchema = new Schema<ILink>({
  label: {
    type: String,
    required: true,
    trim: true,
  },
  url: {
    type: String,
    required: true,
    trim: true,
  },
  icon: {
    type: String,
    enum: ["external", "github", "notepad"],
    default: "external",
  },
});

const SourceRepositorySchema = new Schema<ISourceRepository>(
  {
    provider: {
      type: String,
      enum: ["github"],
      required: true,
    },
    owner: {
      type: String,
      required: true,
      trim: true,
    },
    repo: {
      type: String,
      required: true,
      trim: true,
    },
    url: {
      type: String,
      required: true,
      trim: true,
    },
    branch: {
      type: String,
      trim: true,
    },
  },
  {
    _id: false,
  },
);

const ProjectSchema = new Schema<IProject>(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    subtitle: {
      type: String,
      required: true,
      trim: true,
    },
    images: {
      type: [String],
      default: [],
    },
    media: {
      type: [String],
      default: [],
    },
    links: [LinkSchema],
    sourceRepository: SourceRepositorySchema,
    markdown: {
      type: String,
      required: true,
      default: "",
    },
    tags: {
      type: [String],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
    order: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  },
);

ProjectSchema.index({ order: 1 });
ProjectSchema.index({ isActive: 1 });
ProjectSchema.index({ isFeatured: 1 });
ProjectSchema.index({ tags: 1 });
ProjectSchema.index({
  "sourceRepository.provider": 1,
  "sourceRepository.owner": 1,
  "sourceRepository.repo": 1,
});

export const Project: mongoose.Model<IProject> =
  mongoose.models.Project || mongoose.model<IProject>("Project", ProjectSchema);
