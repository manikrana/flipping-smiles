export type Database = {
  public: {
    Tables: {
      stories: {
        Row: {
          id: string;
          slug: string;
          title: string;
          description: string;
          age_min: number;
          age_max: number;
          languages: string[];
          cover_image_url: string | null;
          cover_layout: CoverLayout | null;
          price_usd: number;
          status: "draft" | "ready";
          archived: boolean;
          layout_type: LayoutType;
          text_style: TextStyle | null;
          text_panel_bg: TextPanelBg | null;
          hero_costume_description_boy: string | null;
          hero_costume_description_girl: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      story_pages: {
        Row: {
          id: string;
          story_id: string;
          page_number: number;
          text: string;
          scene_prompt: string;
          image_url: string | null;
          image_url_girl: string | null;
          hero_on_page: boolean;
          preview_eligible: boolean;
          text_bg_url: string | null;
          vertical_align: "top" | "center" | "bottom" | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      // Admin-only tables (populated/managed entirely in apps/studio) -- the
      // storefront only reads these, to look up which named cast characters
      // (e.g. "Little Sister - 4 year old") are confirmed present on a given
      // story page, so the order-time AI swap knows exactly who NOT to touch.
      cast_characters: {
        Row: {
          id: string;
          name: string;
          description: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      page_cast: {
        Row: {
          page_id: string;
          character_id: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      // Age-banded hero template variants (populated entirely in apps/studio)
      // -- the storefront only reads these, to pick the template matching the
      // order's child_age before running the identity swap.
      story_page_age_variants: {
        Row: {
          page_id: string;
          age_band: "1-4" | "5-8" | "9-12";
          image_url: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      // Real Gemini API call log -- both apps write here (shared Supabase
      // project via the service-role key). Mirrors apps/studio's entry.
      gemini_call_log: {
        Row: {
          id: string;
          call_type: string;
          story_id: string | null;
          page_id: string | null;
          order_id: string | null;
          estimated_cost_usd: number;
          created_at: string;
        };
        Insert: {
          call_type: string;
          story_id?: string | null;
          page_id?: string | null;
          order_id?: string | null;
          estimated_cost_usd: number;
        };
        Update: never;
        Relationships: [];
      };
      characters: {
        Row: {
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
        Insert: Omit<Database["public"]["Tables"]["characters"]["Row"], "id" | "created_at" | "sheet_url" | "head_sheet_url">;
        Update: Partial<Database["public"]["Tables"]["characters"]["Row"]>;
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
        Insert: Omit<Database["public"]["Tables"]["feedback"]["Row"], "id" | "created_at" | "status"> & { status?: string; image_url?: string | null };
        Update: never;
        Relationships: [];
      };
      orders: {
        Row: {
          id: string;
          story_id: string;
          character_id: string;
          language: string;
          hero_name: string;
          gender: "boy" | "girl";
          status: string;
          stripe_payment_intent_id: string | null;
          pdf_url: string | null;
          shipping_address: Record<string, unknown>;
          child_age: number | null;
          amount_usd: number;
          gelato_order_id: string | null;
          tracking_number: string | null;
          tracking_url: string | null;
          carrier_name: string | null;
          contact_email: string | null;
          contact_phone: string | null;
          cart_id: string | null;
          pdf_page_count: number | null;
          costumed_sheet_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["orders"]["Row"], "id" | "created_at" | "updated_at" | "contact_email" | "contact_phone" | "gelato_order_id" | "tracking_number" | "tracking_url" | "carrier_name" | "cart_id" | "pdf_page_count" | "costumed_sheet_url">
          & { contact_email?: string | null; contact_phone?: string | null; gelato_order_id?: string | null; tracking_number?: string | null; tracking_url?: string | null; carrier_name?: string | null; cart_id?: string | null; pdf_page_count?: number | null; costumed_sheet_url?: string | null };
        Update: Partial<Omit<Database["public"]["Tables"]["orders"]["Row"], "id" | "created_at">>;
        Relationships: [];
      };
      order_pages: {
        Row: {
          id: string;
          order_id: string;
          page_number: number;
          scene_prompt: string;
          hero_name: string;
          generation_status: "pending" | "processing" | "upscaling" | "done" | "failed";
          image_url: string | null;
          upscaled_image_url: string | null;
          text_image_url: string | null;
          replicate_job_id: string | null;
          upscale_job_id: string | null;
          error_message: string | null;
          created_at: string;
          // Set by the order-time identity swap's judge-and-retry loop --
          // null for any page generated before that existed.
          identity_verified: boolean | null;
        };
        Insert: Omit<Database["public"]["Tables"]["order_pages"]["Row"], "id" | "created_at">;
        Update: Partial<Omit<Database["public"]["Tables"]["order_pages"]["Row"], "id" | "created_at">>;
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
      rate_limit_hits: {
        Row: {
          id: string;
          key: string;
          created_at: string;
        };
        Insert: {
          key: string;
        };
        Update: never;
        Relationships: [];
      };
      brand_settings: {
        Row: {
          id: string;
          company_name: string | null;
          website_url: string | null;
          instagram_url: string | null;
          back_cover_leading_text: string | null;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

export type StoryRow = Database["public"]["Tables"]["stories"]["Row"];
export type StoryPageRow = Database["public"]["Tables"]["story_pages"]["Row"];

export type LayoutType = "overlay_bottom" | "split_image_left" | "split_image_right" | "spread_left" | "spread_right" | "spread_left_clean" | "spread_right_clean";

// Mirrors apps/studio/src/lib/supabase/types.ts's CoverLayout exactly -- the
// storefront needs to composite the front-cover title/subtitle the same way
// the print pipeline does (see lib/layout.ts's renderCoverSpread there) so
// what a customer sees here is what actually prints (WYSIWYG).
export type TitleBlockPosition =
  | "top-left" | "top-center" | "top-right"
  | "middle-left" | "middle-center" | "middle-right"
  | "bottom-left" | "bottom-center" | "bottom-right";

export type CoverLayout = {
  subtitle: string;
  fontFamily: string;
  titlePosition: TitleBlockPosition;
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

export type TextPanelBg =
  | { type: "none" }
  | { type: "solid"; color: string }
  | { type: "gradient"; from: string; to: string; direction: "to-bottom" | "to-right" | "to-bottom-right" }
  | { type: "pattern"; patternId: string; color: string; bgColor: string }
  | { type: "scene_bleed" };

export const DEFAULT_TEXT_PANEL_BG: TextPanelBg = { type: "scene_bleed" };
