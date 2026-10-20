export type BrandSettingsRow = {
  id: string;
  company_name: string | null;
  website_url: string | null;
  instagram_url: string | null;
  back_cover_leading_text: string | null;
  updated_at: string;
};

type StoryRow_ = {
  id: string;
  slug: string;
  title: string;
  description: string;
  age_min: number;
  age_max: number;
  languages: string[];
  cover_image_url: string | null;
  cover_image_url_girl: string | null;
  price_usd: number;
  scene_model: "flux" | "nano-banana-pro";
  text_style: TextStyle | null;
  status: "draft" | "ready";
  dedication_text: string | null;
  end_page_text: string;
  end_page_prompt: string | null;
  end_page_image_url: string | null;
  back_cover_text: string | null;
  front_spread_text_style: TextStyle | null;
  dedication_text_style: TextStyle | null;
  title_page_text_style: TextStyle | null;
  end_page_text_style: TextStyle | null;
  front_endpaper_bg: TextPanelBg | null;
  front_endpaper_text: string | null;
  front_endpaper_text_style: TextStyle | null;
  back_endpaper_bg: TextPanelBg | null;
  back_endpaper_text: string | null;
  back_endpaper_text_style: TextStyle | null;
  back_endpaper_qr_url: string | null;
  back_cover_featured_story_ids: string[];
  back_cover_website_qr_url: string | null;
  back_cover_social_qr_url: string | null;
  back_cover_website_text: string | null;
  back_cover_tagline: string | null;
  cover_hero_boy_character_id: string | null;
  cover_hero_girl_character_id: string | null;
  // Blank-silhouette hero cover, used only by the order-time identity swap --
  // never shown to customers. cover_image_url/cover_image_url_girl (above)
  // remain the storefront-facing display covers, untouched by this field.
  cover_swap_template_url: string | null;
  // A specific, concrete outfit description (e.g. "a khaki safari vest,
  // light-blue tee, cargo shorts, brown boots") baked onto the order-time
  // costumed identity sheet (see orders.costumed_sheet_url) when set; falls
  // back to generic scene-appropriate clothing when null. Split by gender
  // since a book's boy and girl outfits are typically different.
  hero_costume_description_boy: string | null;
  hero_costume_description_girl: string | null;
  brand_page_prompt: string | null;
  brand_page_image_url: string | null;
  cover_layout: CoverLayout | null;
  layout_type: "overlay_bottom" | "split_image_left" | "split_image_right" | "spread_left" | "spread_right" | "spread_left_clean" | "spread_right_clean";
  continuity_reference_page_id: string | null;
  text_panel_bg: TextPanelBg | null;
  generation_style: string;
  trim_size_id: string | null;
  binding_type: "hardcover" | "paperback";
  print_provider_id: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
};

type StoryPageRow_ = {
  id: string;
  story_id: string;
  page_number: number;
  text: string;
  scene_prompt: string;
  scene_prompt_girl: string | null;
  hero_boy_character_id: string | null;
  hero_girl_character_id: string | null;
  image_url: string | null;
  image_url_girl: string | null;
  image_approved: boolean;
  text_image_url: string | null;
  text_bg_url: string | null;
  default_character_description: string | null;
  preview_eligible: boolean;
  continuity_reference_page_id: string | null;
  vertical_align: "top" | "center" | "bottom" | null;
  // Set by a post-generation Gemini judge call in generateSpreadScene --
  // verifies the base template rendered exactly (reference characters + hero)
  // people, no more, no fewer. Null for pages generated before this check
  // existed. No auto-retry -- admin decides whether to regen.
  character_count_verified: boolean | null;
  created_at: string;
};

type CastCharacterRow_ = {
  id: string;
  name: string;
  description: string;
  reference_url: string | null;
  sheet_url: string | null;
  scene_model: string;
  reference_model: string;
  lora_status: "none" | "training" | "ready" | "failed";
  lora_url: string | null;
  trigger_word: string | null;
  lora_training_id: string | null;
  character_type: "cast" | "hero";
  cloned_from_id: string | null;
  created_at: string;
};

type CastCharacterReferenceRow_ = {
  id: string;
  character_id: string;
  image_url: string;
  view: string;
  created_at: string;
};

type StoryCastRow_ = {
  story_id: string;
  character_id: string;
  sort_order: number;
};

type PageCastRow_ = {
  page_id: string;
  character_id: string;
};

type AgeBandRow_ = "1-4" | "5-8" | "9-12";

type StoryPageAgeVariantRow_ = {
  page_id: string;
  age_band: AgeBandRow_;
  image_url: string | null;
  created_at: string;
};

type StoryCoverAgeVariantRow_ = {
  story_id: string;
  age_band: AgeBandRow_;
  image_url: string | null;
  created_at: string;
};

type GeminiCallLogRow_ = {
  id: string;
  call_type: string;
  story_id: string | null;
  page_id: string | null;
  order_id: string | null;
  estimated_cost_usd: number;
  created_at: string;
};

type CharacterRow_ = {
  id: string;
  source_image_url: string | null;
  cartoon_image_url: string | null;
  sheet_url: string | null;
  head_sheet_url: string | null;
  hero_name: string;
  generation_status: "pending" | "processing" | "done" | "failed";
  replicate_job_id: string | null;
  is_default: boolean;
  default_gender: "boy" | "girl" | null;
  created_at: string;
};

type OrderRow_ = {
  id: string;
  story_id: string;
  character_id: string;
  language: string;
  hero_name: string;
  gender: "boy" | "girl";
  status: string;
  stripe_payment_intent_id: string | null;
  pdf_url: string | null;
  cover_image_url: string | null;
  shipping_address: Record<string, unknown>;
  amount_usd: number;
  archived: boolean;
  gelato_order_id: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  carrier_name: string | null;
  cart_id: string | null;
  pdf_page_count: number | null;
  child_age: number | null;
  // The order-time costumed identity sheet (an edit of the character's
  // neutral sheet with the story's gendered costume applied), cached here so
  // it's generated once per order and reused for every page + cover swap.
  costumed_sheet_url: string | null;
  created_at: string;
  updated_at: string;
};

type OrderPageRow_ = {
  id: string;
  order_id: string;
  page_number: number;
  scene_prompt: string;
  hero_name: string;
  image_url: string | null;
  upscaled_image_url: string | null;
  text_image_url: string | null;
  generation_status: "pending" | "processing" | "upscaling" | "done" | "failed";
  replicate_job_id: string | null;
  upscale_job_id: string | null;
  error_message: string | null;
  created_at: string;
  // Set by the order-time identity swap's judge-and-retry loop -- null for
  // any page generated before that existed (no judge ever ran).
  identity_verified: boolean | null;
};

export type TextPanelBg =
  | { type: "none" }
  | { type: "solid"; color: string }
  | { type: "gradient"; from: string; to: string; direction: "to-bottom" | "to-right" | "to-bottom-right" }
  | { type: "pattern"; patternId: string; color: string; bgColor: string }
  | { type: "scene_bleed" };

export const DEFAULT_TEXT_PANEL_BG: TextPanelBg = { type: "scene_bleed" };

type PrintProviderRow_ = {
  id: string;
  name: string;
  slug: string;
  created_at: string;
};

type PrintProviderTrimSizeRow_ = {
  id: string;
  provider_id: string;
  name: string;
  width_in: number;
  height_in: number;
  bleed_in: number;
  safety_in: number;
  dpi: number;
  created_at: string;
};

// 9-zone placement for the ingrained title/subtitle block on the front cover
// -- descriptive language only (fed into the Gemini prompt), not pixel
// coordinates, since the text is now baked into the AI art itself rather
// than composited afterward. See lib/coverPrompt.ts.
export type TitleBlockPosition =
  | "top-left" | "top-center" | "top-right"
  | "middle-left" | "middle-center" | "middle-right"
  | "bottom-left" | "bottom-center" | "bottom-right";

export type CoverLayout = {
  subtitle: string;
  fontFamily: string;
  titlePosition: TitleBlockPosition;
  // Dead for rendering purposes now that title/subtitle are baked into the
  // generated art instead of composited as an SVG overlay -- left in place
  // rather than a disruptive type/data migration for a few unused jsonb keys.
  titleColor: string;
  subtitleColor: string;
  overlayOpacity: number;
  titleSize: number;
  subtitleSize: number;
};

export const DEFAULT_COVER_LAYOUT: CoverLayout = {
  subtitle: "A story starring {{hero_name}}",
  fontFamily: "Dancing Script, cursive",
  titlePosition: "middle-center",
  titleColor: "#ffffff",
  subtitleColor: "#f0e6ff",
  overlayOpacity: 0.45,
  titleSize: 8,
  subtitleSize: 4.5,
};

export type TextStyle = {
  fontFamily: string;
  fontSizePct: number;
  color: string;
  bgColor: string;
  bgOpacity: number;
  alignment: "left" | "center" | "right";
  italic?: boolean;
  textBoxBg?: "none" | "frosted_glass";
};

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: "Georgia, serif",
  fontSizePct: 4.5,
  color: "#1c1c1e",
  bgColor: "#ffffff",
  bgOpacity: 0.86,
  alignment: "center",
};

export type Database = {
  public: {
    Tables: {
      stories: {
        Row: StoryRow_;
        Insert: Pick<StoryRow_, "title" | "slug" | "description" | "age_min" | "age_max" | "price_usd" | "languages"> & {
          cover_image_url?: string | null;
          cover_image_url_girl?: string | null;
          scene_model?: "flux" | "nano-banana-pro";
          text_style?: TextStyle | null;
          status?: "draft" | "ready";
          dedication_text?: string | null;
          end_page_text?: string;
          back_cover_text?: string | null;
          cover_layout?: CoverLayout | null;
          layout_type?: "overlay_bottom" | "split_image_left" | "split_image_right" | "spread_left" | "spread_right" | "spread_left_clean" | "spread_right_clean";
          text_panel_bg?: TextPanelBg | null;
          generation_style?: string;
          trim_size_id?: string | null;
          binding_type?: "hardcover" | "paperback";
          print_provider_id?: string | null;
        };
        Update: Partial<Omit<StoryRow_, "id" | "created_at" | "updated_at">>;
        Relationships: [];
      };
      story_pages: {
        Row: StoryPageRow_;
        Insert: Omit<StoryPageRow_, "id" | "created_at" | "image_url" | "image_url_girl" | "image_approved" | "preview_eligible" | "text_image_url" | "text_bg_url" | "default_character_description" | "scene_prompt_girl" | "hero_boy_character_id" | "hero_girl_character_id" | "continuity_reference_page_id" | "vertical_align" | "character_count_verified"> & {
          image_url?: string | null;
          image_url_girl?: string | null;
          image_approved?: boolean;
          preview_eligible?: boolean;
          text_image_url?: string | null;
          text_bg_url?: string | null;
          default_character_description?: string | null;
          scene_prompt_girl?: string | null;
          hero_boy_character_id?: string | null;
          hero_girl_character_id?: string | null;
          continuity_reference_page_id?: string | null;
          vertical_align?: "top" | "center" | "bottom" | null;
          character_count_verified?: boolean | null;
        };
        Update: Partial<Omit<StoryPageRow_, "id" | "created_at">>;
        Relationships: [];
      };
      feedback: {
        Row: {
          id: string;
          site: string;
          type: "bug" | "feature";
          title: string;
          description: string;
          url: string | null;
          image_url: string | null;
          status: "open" | "in_progress" | "done" | "dismissed";
          created_at: string;
        };
        Insert: { site: string; type: string; title: string; description: string; url?: string | null; image_url?: string | null; status?: string };
        Update: Partial<{ status: string }>;
        Relationships: [];
      };
      cast_characters: {
        Row: CastCharacterRow_;
        Insert: Omit<CastCharacterRow_, "id" | "created_at" | "lora_status" | "lora_url" | "trigger_word" | "lora_training_id" | "sheet_url" | "scene_model" | "character_type" | "cloned_from_id"> & {
          lora_status?: "none" | "training" | "ready" | "failed";
          lora_url?: string | null;
          trigger_word?: string | null;
          lora_training_id?: string | null;
          sheet_url?: string | null;
          scene_model?: string;
          character_type?: "cast" | "hero";
          cloned_from_id?: string | null;
        };
        Update: Partial<Omit<CastCharacterRow_, "id" | "created_at">>;
        Relationships: [];
      };
      cast_character_references: {
        Row: CastCharacterReferenceRow_;
        Insert: Omit<CastCharacterReferenceRow_, "id" | "created_at" | "view"> & { view?: string };
        Update: Partial<Omit<CastCharacterReferenceRow_, "id" | "created_at">>;
        Relationships: [];
      };
      story_cast: {
        Row: StoryCastRow_;
        Insert: StoryCastRow_;
        Update: Partial<StoryCastRow_>;
        Relationships: [];
      };
      page_cast: {
        Row: PageCastRow_;
        Insert: PageCastRow_;
        Update: Partial<PageCastRow_>;
        Relationships: [];
      };
      characters: {
        Row: CharacterRow_;
        Insert: Omit<CharacterRow_, "id" | "created_at" | "head_sheet_url"> & { head_sheet_url?: string | null };
        Update: Partial<Omit<CharacterRow_, "id" | "created_at">>;
        Relationships: [];
      };
      orders: {
        Row: OrderRow_;
        Insert: Omit<OrderRow_, "id" | "created_at" | "updated_at" | "gelato_order_id" | "tracking_number" | "tracking_url" | "carrier_name" | "cart_id" | "pdf_page_count" | "child_age" | "costumed_sheet_url">
          & { gelato_order_id?: string | null; tracking_number?: string | null; tracking_url?: string | null; carrier_name?: string | null; cart_id?: string | null; pdf_page_count?: number | null; child_age?: number | null; costumed_sheet_url?: string | null };
        Update: Partial<Omit<OrderRow_, "id" | "created_at" | "updated_at">>;
        Relationships: [];
      };
      story_page_age_variants: {
        Row: StoryPageAgeVariantRow_;
        Insert: Omit<StoryPageAgeVariantRow_, "created_at"> & { created_at?: string };
        Update: Partial<StoryPageAgeVariantRow_>;
        Relationships: [];
      };
      story_cover_age_variants: {
        Row: StoryCoverAgeVariantRow_;
        Insert: Omit<StoryCoverAgeVariantRow_, "created_at"> & { created_at?: string };
        Update: Partial<StoryCoverAgeVariantRow_>;
        Relationships: [];
      };
      gemini_call_log: {
        Row: GeminiCallLogRow_;
        Insert: Omit<GeminiCallLogRow_, "id" | "created_at"> & { id?: string; created_at?: string };
        Update: Partial<GeminiCallLogRow_>;
        Relationships: [];
      };
      order_pages: {
        Row: OrderPageRow_;
        Insert: Omit<OrderPageRow_, "id" | "created_at">;
        Update: Partial<Omit<OrderPageRow_, "id" | "created_at">>;
        Relationships: [];
      };
      print_providers: {
        Row: PrintProviderRow_;
        Insert: Omit<PrintProviderRow_, "id" | "created_at">;
        Update: Partial<Omit<PrintProviderRow_, "id" | "created_at">>;
        Relationships: [];
      };
      print_provider_trim_sizes: {
        Row: PrintProviderTrimSizeRow_;
        Insert: Omit<PrintProviderTrimSizeRow_, "id" | "created_at">;
        Update: Partial<Omit<PrintProviderTrimSizeRow_, "id" | "created_at">>;
        Relationships: [];
      };
      analytics_events: {
        Row: {
          id: string;
          event_name: string;
          session_id: string | null;
          story_id: string | null;
          order_id: string | null;
          properties: Record<string, unknown>;
          created_at: string;
        };
        Insert: {
          event_name: string;
          session_id?: string | null;
          story_id?: string | null;
          order_id?: string | null;
          properties?: Record<string, unknown>;
        };
        Update: never;
        Relationships: [];
      };
      brand_settings: {
        Row: BrandSettingsRow;
        Insert: Partial<Omit<BrandSettingsRow, "updated_at">>;
        Update: Partial<Omit<BrandSettingsRow, "id">>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
};

export type StoryRow = StoryRow_;
export type StoryPageRow = StoryPageRow_;
export type CastCharacterRow = CastCharacterRow_;
export type CastCharacterReferenceRow = CastCharacterReferenceRow_;
export type StoryCastRow = StoryCastRow_;
export type PageCastRow = PageCastRow_;
export type AgeBandRow = AgeBandRow_;
export type StoryPageAgeVariantRow = StoryPageAgeVariantRow_;
export type StoryCoverAgeVariantRow = StoryCoverAgeVariantRow_;
export type GeminiCallLogRow = GeminiCallLogRow_;
export type CharacterRow = CharacterRow_;
export type OrderRow = OrderRow_;
export type OrderPageRow = OrderPageRow_;
export type PrintProviderRow = PrintProviderRow_;
export type PrintProviderTrimSizeRow = PrintProviderTrimSizeRow_;
