export interface Character {
  id: string;
  orderId: string;
  sourceImageUrl: string; // original uploaded photo
  cartoonImageUrl?: string; // Pixar-style generated character
  heroName: string;
  generationStatus: "pending" | "processing" | "done" | "failed";
  replicateJobId?: string;
  createdAt: string;
}
