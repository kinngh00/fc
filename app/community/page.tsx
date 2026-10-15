import { CommunitySection } from "../community";
import { SiteFooter, SiteHeader } from "../site-chrome";

export default function CommunityPage() {
  return <main className="community-page"><SiteHeader active="community" /><CommunitySection /><SiteFooter /></main>;
}
