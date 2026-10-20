import React from "react";
import { Document, Page, Text, Image, View, StyleSheet, pdf } from "@react-pdf/renderer";
import type { Story, Character, Language } from "@kitabee/core";

export interface PdfGenerationInput {
  story: Story;
  character: Character;
  heroName: string;
  language: Language;
}

// A4 landscape: 841.89 x 595.28 pt
// Text zone matches the bottom 30% reserved in scene generation prompts.
const TEXT_ZONE_HEIGHT = "30%";

const styles = StyleSheet.create({
  page: {
    position: "relative",
    backgroundColor: "#1a1a1a",
    padding: 0,
  },
  sceneImage: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
  },
  // Frosted-white panel over the bottom text zone
  textPanel: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: TEXT_ZONE_HEIGHT,
    backgroundColor: "rgba(255,255,255,0.88)",
    paddingHorizontal: 36,
    paddingVertical: 20,
    justifyContent: "center",
  },
  storyText: {
    fontSize: 17,
    lineHeight: 1.65,
    fontFamily: "Helvetica",
    color: "#1e1e1e",
  },
  pageNumber: {
    position: "absolute",
    bottom: 10,
    right: 18,
    fontSize: 9,
    color: "rgba(60,60,60,0.5)",
    fontFamily: "Helvetica",
  },
  // Fallback when no scene image exists yet
  placeholder: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    backgroundColor: "#e8e0d5",
    alignItems: "center",
    justifyContent: "center",
  },
  placeholderText: {
    fontSize: 14,
    color: "#999",
    fontFamily: "Helvetica",
  },
});

function interpolate(text: string, heroName: string): string {
  return text.replace(/\{\{hero_name\}\}/g, heroName);
}

function StoryDocument({ story, heroName }: { story: Story; heroName: string }) {
  return (
    <Document title={story.title} author="Kitabee">
      {story.pages.map((page) => (
        <Page key={page.id} size="A4" style={styles.page} orientation="landscape">
          {page.imageUrl ? (
            <Image src={page.imageUrl} style={styles.sceneImage} />
          ) : (
            <View style={styles.placeholder}>
              <Text style={styles.placeholderText}>Scene not yet generated</Text>
            </View>
          )}

          {/* Semi-transparent text panel — matches the bottom 30% left clear by scene generation */}
          <View style={styles.textPanel}>
            <Text style={styles.storyText}>
              {interpolate(page.text, heroName)}
            </Text>
          </View>

          <Text style={styles.pageNumber}>{page.pageNumber}</Text>
        </Page>
      ))}
    </Document>
  );
}

export async function generateStoryPdf(input: PdfGenerationInput): Promise<Buffer> {
  const { story, heroName } = input;
  const blob = await pdf(<StoryDocument story={story} heroName={heroName} />).toBlob();
  const arrayBuffer = await blob.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
