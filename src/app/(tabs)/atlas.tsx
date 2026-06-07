import { TopicAtlasView } from '@ui/TopicAtlasView';

/**
 * The `/map` route. The per-post radial map was removed — the route now always
 * renders the global topic atlas, ignoring any (legacy) `anchor` param.
 */
export default function MapScreen() {
  return <TopicAtlasView />;
}
