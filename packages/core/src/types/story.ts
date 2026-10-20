export type Language = "en" | "hi" | "te";

export interface StoryPage {
  id: string;
  pageNumber: number;
  text: string; // supports {{hero_name}} placeholder
  scenePrompt: string; // image generation prompt for this scene
  imageUrl?: string;
}

export interface Story {
  id: string;
  slug: string;
  title: string;
  description: string;
  ageRange: [number, number];
  languages: Language[];
  pages: StoryPage[];
  coverImageUrl?: string;
  priceUsd: number;
  createdAt: string;
  updatedAt: string;
}

export interface LocalizedStory extends Omit<Story, "pages" | "title" | "description"> {
  language: Language;
  title: string;
  description: string;
  pages: StoryPage[];
}
