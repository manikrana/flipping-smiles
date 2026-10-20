import { getBrandSettings } from "./actions";
import { SettingsForm } from "./SettingsForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = await getBrandSettings();
  return <SettingsForm settings={settings} />;
}
