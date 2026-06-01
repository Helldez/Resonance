import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, View, useWindowDimensions, ScrollView, type LayoutChangeEvent } from 'react-native';
import {
  Surface,
  Text,
  Button,
  IconButton,
  Portal,
  Dialog,
  useTheme,
} from 'react-native-paper';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, G, Line, Rect, Text as SvgText } from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useRequireContainer } from '@ui/AppContainerContext';
import { useSettingsStore } from '@domain/SettingsStore';
import { getMapView } from '@core/posts/GetMapCandidates';
import type { MapView } from '@core/posts/GetMapCandidates';
import { radiusForSimilarity } from '@core/matching/Project2D';
import { MatchingConfig } from '@core/config/MatchingConfig';
import { RoomConfig } from '@core/config/RoomConfig';
import { ThemeConfig } from '@core/config/ThemeConfig';
import { formatAuthor, shortPeer } from '@domain/AuthorFormatting';
import { clamp01, interpolateColor, colorForAuthor } from '@ui/colorMath';
import { TopicAtlasView } from '@ui/TopicAtlasView';
import type { PeerId, RecordAddress } from '@core/domain/types';

interface SelectedPoint {
  readonly address: RecordAddress;
  readonly author: PeerId;
  readonly text: string;
  readonly similarity: number;
  readonly isAnchor: boolean;
}

/**
 * The `/map` route. With an explicit `anchor` (opened from a post) it shows
 * the per-post radial map. With no anchor (the Feed "Map" button) it shows
 * the global topic atlas of all local posts.
 */
export default function MapScreen() {
  const { anchor } = useLocalSearchParams<{ anchor: string }>();
  if (typeof anchor === 'string' && anchor.length > 0) {
    return <PerPostMapScreen />;
  }
  return <TopicAtlasView />;
}

function PerPostMapScreen() {
  const { anchor: anchorParam } = useLocalSearchParams<{ anchor: string }>();
  const container = useRequireContainer();
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const displayName = useSettingsStore((s) => s.displayName);
  const threshold = useSettingsStore((s) => s.similarityThreshold);
  const { width, height } = useWindowDimensions();

  const [view, setView] = useState<MapView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedPoint | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [scale, setScale] = useState(1);
  const [panStart, setPanStart] = useState<{ tx: number; ty: number } | null>(null);
  const [scaleStart, setScaleStart] = useState<number | null>(null);

  // Refs for transform state — the gesture callbacks read these via
  // `current` so the gesture instances stay stable across re-renders. If
  // we put `tx, ty, scale` in the gesture's useMemo deps, the
  // GestureDetector receives a fresh gesture object on every pan frame,
  // which causes gesture-handler to lose internal tracking — the visible
  // symptom is "taps stop working".
  const txRef = useRef(0);
  const tyRef = useRef(0);
  const scaleRef = useRef(1);
  useEffect(() => {
    txRef.current = tx;
  }, [tx]);
  useEffect(() => {
    tyRef.current = ty;
  }, [ty]);
  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  // Actual SVG draw area — we exclude the floating header and the legend
  // from the gesture/projection space so the anchor at viewBox (0,0)
  // appears at the visual center of the empty area, not the screen
  // center (which is hidden behind the header).
  const [svgLayout, setSvgLayout] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const onSvgLayout = (e: LayoutChangeEvent): void => {
    const { x, y, width: w, height: h } = e.nativeEvent.layout;
    if (
      svgLayout === null ||
      svgLayout.x !== x ||
      svgLayout.y !== y ||
      svgLayout.width !== w ||
      svgLayout.height !== h
    ) {
      setSvgLayout({ x, y, width: w, height: h });
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // An explicit anchor (tapped post) wins and shows the per-post map
        // (peers only). With no anchor this is the global "my posts" map:
        // anchor on the most recent own post and plot ALL local posts,
        // including the user's own, so the whole personal history is visible.
        const explicit =
          typeof anchorParam === 'string' && anchorParam.length > 0;
        const anchorAddress = explicit
          ? (anchorParam as RecordAddress)
          : await resolveDefaultAnchor(container);
        if (cancelled) {
          return;
        }
        if (anchorAddress === null) {
          setLoadError('No posts yet to anchor the map. Write a post first.');
          return;
        }
        const result = await getMapView(
          { posts: container.posts, self: container.self },
          anchorAddress,
          { includeSelf: !explicit, minSimilarity: threshold },
        );
        if (cancelled) {
          return;
        }
        if (result === null) {
          setLoadError('Anchor post not found in local database');
          return;
        }
        setView(result);
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [anchorParam, container, threshold]);

  // Conversion factor in pixels per viewBox unit. The SVG uses
  // `preserveAspectRatio="xMidYMid meet"` with a 2.1×2.1 viewBox (see the
  // `viewBox="-1.05 -1.05 2.1 2.1"` below) inside the measured `svgLayout`;
  // the smaller of width/height drives the scale, the larger gets padded by
  // SVG's intrinsic centering. This divisor MUST match the viewBox span, or
  // the tap hit-test drifts proportionally to distance from centre — the bug
  // where points near the rim were untappable on mobile (divisor was 2.4).
  //
  // Gesture event coordinates differ by platform:
  //   - Android (`react-native-gesture-handler` native): e.x/e.y are
  //     reported relative to an outer ancestor, so we add the inner
  //     View's `layout.x/y` offset to align `svgCenter` with the visual
  //     midpoint of the SVG. This was the fix in commit 6e6b5db.
  //   - Web (`gesture-handler-web` pointer events): e.x/e.y are already
  //     relative to the gesture target view. Adding the offset there
  //     shifts the hit-test origin upward by the header height, which
  //     makes every tap land near (but not on) the wrong dot.
  const containerW = svgLayout?.width ?? width;
  const containerH = svgLayout?.height ?? Math.max(1, height - 220);
  const useOuterOffset = Platform.OS !== 'web';
  const offsetX = useOuterOffset ? svgLayout?.x ?? 0 : 0;
  const offsetY = useOuterOffset ? svgLayout?.y ?? 0 : 0;
  const sideUnits = Math.min(containerW, containerH) / MAP_VIEWBOX_SPAN;
  const svgCenterX = offsetX + containerW / 2;
  const svgCenterY = offsetY + containerH / 2;

  // Stable gesture instances — they read transform state via refs so
  // they do not need to be re-created on every pan/pinch frame, which was
  // the original cause of taps being silently dropped.
  const viewRef = useRef<MapView | null>(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  const sideUnitsRef = useRef(sideUnits);
  useEffect(() => {
    sideUnitsRef.current = sideUnits;
  }, [sideUnits]);
  const svgCenterXRef = useRef(svgCenterX);
  useEffect(() => {
    svgCenterXRef.current = svgCenterX;
  }, [svgCenterX]);
  const svgCenterYRef = useRef(svgCenterY);
  useEffect(() => {
    svgCenterYRef.current = svgCenterY;
  }, [svgCenterY]);
  const containerWRef = useRef(containerW);
  useEffect(() => {
    containerWRef.current = containerW;
  }, [containerW]);
  const containerHRef = useRef(containerH);
  useEffect(() => {
    containerHRef.current = containerH;
  }, [containerH]);

  const composed = useMemo(() => {
    const tap = Gesture.Tap()
      .maxDuration(500)
      .maxDistance(14)
      .numberOfTaps(1)
      .shouldCancelWhenOutside(false)
      .onEnd((e, success) => {
        const src = viewRef.current;
        if (!success || src === null) {
          console.log(`[map] tap onEnd fail success=${success} viewReady=${src !== null}`);
          return;
        }
        const sUnits = sideUnitsRef.current;
        const px = e.x;
        const py = e.y;
        const vbX = (px - svgCenterXRef.current) / sUnits;
        const vbY = (py - svgCenterYRef.current) / sUnits;
        const localX = (vbX - txRef.current) / scaleRef.current;
        const localY = (vbY - tyRef.current) / scaleRef.current;
        const hr = ThemeConfig.map.hitRadiusPx / sUnits / scaleRef.current;
        const hrSq = hr * hr;

        let best: { sq: number; pt: SelectedPoint } | null = null;

        const dxA = src.anchor.plot.x - localX;
        const dyA = src.anchor.plot.y - localY;
        const sqA = dxA * dxA + dyA * dyA;
        if (sqA <= hrSq) {
          best = {
            sq: sqA,
            pt: {
              address: src.anchor.address,
              author: src.anchor.author,
              text: src.anchor.text,
              similarity: src.anchor.plot.similarityToAnchor,
              isAnchor: true,
            },
          };
        }
        for (const p of src.peers) {
          const dx = p.plot.x - localX;
          const dy = p.plot.y - localY;
          const sq = dx * dx + dy * dy;
          if (sq <= hrSq && (best === null || sq < best.sq)) {
            best = {
              sq,
              pt: {
                address: p.address,
                author: p.author,
                text: p.text,
                similarity: p.plot.similarityToAnchor,
                isAnchor: false,
              },
            };
          }
        }
        if (best !== null) {
          setSelected(best.pt);
        }
      });

    const pan = Gesture.Pan()
      .minDistance(8)
      .onStart(() => {
        setPanStart({ tx: txRef.current, ty: tyRef.current });
      })
      .onUpdate((e) => {
        const sUnits = sideUnitsRef.current;
        const dx = e.translationX / sUnits;
        const dy = e.translationY / sUnits;
        const start = panStartRef.current;
        if (start === null) {
          return;
        }
        setTx(start.tx + dx);
        setTy(start.ty + dy);
      })
      .onEnd(() => {
        setPanStart(null);
      });

    const pinch = Gesture.Pinch()
      .onStart(() => {
        setScaleStart(scaleRef.current);
      })
      .onUpdate((e) => {
        const start = scaleStartRef.current;
        if (start === null) {
          return;
        }
        const next = clamp(
          start * e.scale,
          MatchingConfig.mapZoomMin,
          MatchingConfig.mapZoomMax,
        );
        setScale(next);
      })
      .onEnd(() => {
        setScaleStart(null);
      });

    return Gesture.Simultaneous(pinch, Gesture.Race(tap, pan));
  }, []);

  const panStartRef = useRef<{ tx: number; ty: number } | null>(null);
  useEffect(() => {
    panStartRef.current = panStart;
  }, [panStart]);
  const scaleStartRef = useRef<number | null>(null);
  useEffect(() => {
    scaleStartRef.current = scaleStart;
  }, [scaleStart]);

  if (loadError !== null) {
    return (
      <View style={fillCentered(theme.colors.background)}>
        <Text variant="bodyLarge" style={{ color: theme.colors.error }}>
          {loadError}
        </Text>
        <Button onPress={() => router.replace('/')} style={{ marginTop: 12 }}>
          Back to Feed
        </Button>
      </View>
    );
  }

  if (view === null) {
    return (
      <View style={fillCentered(theme.colors.background)}>
        <Text style={{ color: theme.colors.onSurfaceVariant }}>Projecting…</Text>
      </View>
    );
  }

  const anchor = view.anchor;
  const peers = view.peers;
  const hasPeers = peers.length > 0;

  const peerRadius = ThemeConfig.map.peerStarRadiusPx / sideUnits / scale;
  const peerRadiusSelected = ThemeConfig.map.peerStarSelectedRadiusPx / sideUnits / scale;
  // Invisible, generously-sized hit target per point. Native SVG hit-testing
  // (onPress on the circle) is far more reliable than the manual pixel→viewBox
  // tap math on react-native-web, which is why desktop clicks were missing.
  const hitRadius = 18 / sideUnits / scale;
  const anchorRadius = ThemeConfig.map.selfStarRadiusPx / sideUnits / scale;
  const anchorOuterRadius = ThemeConfig.map.selfStarOuterRadiusPx / sideUnits / scale;
  const ringStrokeWidth =
    ThemeConfig.map.referenceRingStrokeWidthPx / sideUnits / scale;
  const ringLabelFontSize = 10 / sideUnits / scale;

  const radialMode = MatchingConfig.mapProjectionMethod === 'radial-sim';
  // Cartesian PCA-2 view (the simulator's "Space"): a grid + axes with one
  // colored dot per local post. Radial-sim keeps the concentric similarity
  // rings instead.
  const cartesianMode = !radialMode;
  const gridStrokeWidth = 1 / sideUnits / scale;
  const axisStrokeWidth = 1.5 / sideUnits / scale;
  const activeRingStrokeWidth =
    ThemeConfig.map.referenceRingActiveStrokeWidthPx / sideUnits / scale;
  // Rings are derived from MatchingConfig.mapReferenceRings, which is itself
  // aligned with thresholdPresets so map labels and Settings chips share one
  // vocabulary. The ring whose similarity equals the active inbox threshold
  // is highlighted (dashed + brand colour + thicker stroke) so the map
  // doubles as a visualiser of the current filter.
  const referenceRings: ReadonlyArray<{
    r: number;
    label: string;
    active: boolean;
    sim: number;
  }> = radialMode
    ? MatchingConfig.mapReferenceRings.similarities.map((sim) => ({
        // Use the SAME anisotropy-corrected transform as the plotted points
        // (Project2D.radiusForSimilarity), so a dot landing on the "0.70" ring
        // really is at cosine 0.70. A raw (1-sim)/2 here would misalign rings
        // and dots once the floor rescale is applied.
        r: radiusForSimilarity(sim, MatchingConfig.mapRadialAnisotropyFloor),
        label: `sim ${sim.toFixed(2)}`,
        active: Math.abs(sim - threshold) < 1e-6,
        sim,
      }))
    : [];

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: ThemeConfig.map.backgroundColor,
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
      }}
    >
      <MapHeader
        peerCount={peers.length}
        hasPeers={hasPeers}
        selfLabel={formatAuthor({
          self: container.self,
          peer: container.self,
          selfDisplayName: displayName,
        })}
        onBack={() => router.back()}
        onInfo={() => setInfoOpen(true)}
      />

      <GestureDetector gesture={composed}>
        <View style={{ flex: 1 }} onLayout={onSvgLayout}>
          <Svg
            width="100%"
            height="100%"
            viewBox="-1.05 -1.05 2.1 2.1"
            preserveAspectRatio="xMidYMid meet"
          >
            <Rect
              x={-1.05}
              y={-1.05}
              width={2.1}
              height={2.1}
              fill={ThemeConfig.map.backgroundColor}
            />
            <G transform={`translate(${tx} ${ty}) scale(${scale})`}>
              {cartesianMode &&
                GRID_TICKS.map((t) => (
                  <Line
                    key={`grid-v-${t}`}
                    x1={t}
                    y1={-1}
                    x2={t}
                    y2={1}
                    stroke={ThemeConfig.map.referenceRingColor}
                    strokeWidth={gridStrokeWidth}
                    opacity={0.25}
                  />
                ))}
              {cartesianMode &&
                GRID_TICKS.map((t) => (
                  <Line
                    key={`grid-h-${t}`}
                    x1={-1}
                    y1={t}
                    x2={1}
                    y2={t}
                    stroke={ThemeConfig.map.referenceRingColor}
                    strokeWidth={gridStrokeWidth}
                    opacity={0.25}
                  />
                ))}
              {cartesianMode && (
                <>
                  <Line
                    x1={0}
                    y1={-1}
                    x2={0}
                    y2={1}
                    stroke={ThemeConfig.map.referenceRingColor}
                    strokeWidth={axisStrokeWidth}
                    opacity={0.6}
                  />
                  <Line
                    x1={-1}
                    y1={0}
                    x2={1}
                    y2={0}
                    stroke={ThemeConfig.map.referenceRingColor}
                    strokeWidth={axisStrokeWidth}
                    opacity={0.6}
                  />
                </>
              )}
              {referenceRings.map((ring) => (
                <Circle
                  key={`ring-${ring.sim}`}
                  cx={0}
                  cy={0}
                  r={ring.r}
                  fill="none"
                  stroke={
                    ring.active
                      ? ThemeConfig.map.referenceRingActiveColor
                      : ThemeConfig.map.referenceRingColor
                  }
                  strokeWidth={ring.active ? activeRingStrokeWidth : ringStrokeWidth}
                  strokeDasharray={
                    ring.active
                      ? ThemeConfig.map.referenceRingActiveDashArray
                      : undefined
                  }
                />
              ))}
              {referenceRings.map((ring) => (
                <SvgText
                  key={`ring-label-${ring.sim}`}
                  x={0}
                  y={-ring.r - ringLabelFontSize * 0.4}
                  fontSize={ringLabelFontSize}
                  fill={
                    ring.active
                      ? ThemeConfig.map.referenceRingActiveLabelColor
                      : ThemeConfig.map.referenceRingLabelColor
                  }
                  textAnchor="middle"
                  opacity={ring.active ? 1.0 : 0.8}
                >
                  {ring.label}
                </SvgText>
              ))}

              {/* Connecting links only make sense in radial mode, where the
                  geometry is anchor-centric. The cartesian view mirrors the
                  simulator's plain scatter — no links. */}
              {radialMode &&
                peers.map((p) => {
                if (p.plot.similarityToAnchor < MatchingConfig.mapLineMinSimilarity) {
                  return null;
                }
                const t = clamp01((p.plot.similarityToAnchor + 1) / 2);
                const w = t * (ThemeConfig.map.linkMaxWidthPx / sideUnits / scale);
                return (
                  <Line
                    key={`line-${p.address}`}
                    x1={anchor.plot.x}
                    y1={anchor.plot.y}
                    x2={p.plot.x}
                    y2={p.plot.y}
                    stroke={ThemeConfig.map.linkColor}
                    strokeWidth={w}
                    opacity={t * ThemeConfig.map.linkMaxOpacity}
                  />
                );
              })}

              {peers.map((p) => {
                const isSelected = selected !== null && selected.address === p.address;
                const isOwn = p.author === container.self;
                const color = isSelected
                  ? ThemeConfig.map.peerStarSelectedColor
                  : isOwn
                    ? ThemeConfig.map.selfStarColor
                    : cartesianMode
                      ? colorForAuthor(p.author)
                      : interpolateColor(
                          ThemeConfig.map.peerStarColorLow,
                          ThemeConfig.map.peerStarColorHigh,
                          clamp01((p.plot.similarityToAnchor + 1) / 2),
                        );
                const r = isSelected ? peerRadiusSelected : peerRadius;
                return (
                  <Circle
                    key={p.address}
                    cx={p.plot.x}
                    cy={p.plot.y}
                    r={r}
                    fill={color}
                  />
                );
              })}

              {/* No per-point numeric labels — like the simulator's Space
                  view, the exact similarity is shown in the bottom sheet when
                  a point is tapped. */}

              <Circle
                cx={anchor.plot.x}
                cy={anchor.plot.y}
                r={anchorOuterRadius}
                fill={ThemeConfig.map.selfStarOuterColor}
                opacity={0.35}
              />
              <Circle
                cx={anchor.plot.x}
                cy={anchor.plot.y}
                r={anchorRadius}
                fill={ThemeConfig.map.selfStarColor}
              />

              {/* Top layer of invisible, large hit targets. Native SVG
                  onPress per point is reliable on web where the manual tap
                  hit-test is not. Rendered last so it catches the click. */}
              {peers.map((p) => (
                <Circle
                  key={`hit-${p.address}`}
                  cx={p.plot.x}
                  cy={p.plot.y}
                  r={hitRadius}
                  fill={ThemeConfig.map.peerStarColorLow}
                  opacity={0}
                  onPress={() =>
                    setSelected({
                      address: p.address,
                      author: p.author,
                      text: p.text,
                      similarity: p.plot.similarityToAnchor,
                      isAnchor: false,
                    })
                  }
                />
              ))}
              <Circle
                cx={anchor.plot.x}
                cy={anchor.plot.y}
                r={hitRadius}
                fill={ThemeConfig.map.selfStarColor}
                opacity={0}
                onPress={() =>
                  setSelected({
                    address: anchor.address,
                    author: anchor.author,
                    text: anchor.text,
                    similarity: anchor.plot.similarityToAnchor,
                    isAnchor: true,
                  })
                }
              />
            </G>
          </Svg>
        </View>
      </GestureDetector>

      <MapLegendBar
        visible={radialMode}
        onReset={() => {
          setTx(0);
          setTy(0);
          setScale(1);
        }}
      />

      {selected !== null && (
        <SelectedSheet
          selected={selected}
          bottomOffset={insets.bottom + 110}
          onClose={() => setSelected(null)}
          onOpenThread={() => {
            const target = selected.address;
            setSelected(null);
            router.push({ pathname: '/thread/[id]', params: { id: target } });
          }}
        />
      )}

      <Portal>
        <Dialog visible={infoOpen} onDismiss={() => setInfoOpen(false)}>
          <Dialog.Title>How to read this map</Dialog.Title>
          <Dialog.Content>
            {cartesianMode ? (
              <>
                <Text variant="bodyMedium" style={{ marginBottom: 8 }}>
                  The bright star is your anchor post. Every other point is a
                  post your device currently holds from the room.
                </Text>
                <Text variant="bodyMedium" style={{ marginBottom: 8 }}>
                  This is a{' '}
                  <Text style={{ fontWeight: '700' }}>
                    2-D PCA projection of the embedding space
                  </Text>
                  : points that sit close together are semantically similar.
                  The axes have no intrinsic meaning — only relative positions
                  do.
                </Text>
                <Text variant="bodyMedium" style={{ marginBottom: 8 }}>
                  Each point is{' '}
                  <Text style={{ fontWeight: '700' }}>coloured by its author</Text>
                  , so one person's posts share a hue.
                </Text>
                <Text variant="bodyMedium" style={{ marginBottom: 8 }}>
                  Unlike a simulation's global view, this shows only your{' '}
                  <Text style={{ fontWeight: '700' }}>local slice of the room</Text>
                  : your own posts plus your bounded top-
                  {RoomConfig.inboxCapacity} inbox.
                </Text>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  Pinch to zoom. Drag to pan. Tap any point to read.
                </Text>
              </>
            ) : (
              <>
                <Text variant="bodyMedium" style={{ marginBottom: 8 }}>
                  The bright white star at the center is your anchor post.
                </Text>
                <Text variant="bodyMedium" style={{ marginBottom: 8 }}>
                  Every other star is a recent post from a peer.{' '}
                  <Text style={{ fontWeight: '700' }}>
                    Distance from the center = semantic similarity.
                  </Text>{' '}
                  Closer to center means more affine; near the edge means
                  unrelated.
                </Text>
                <Text variant="bodyMedium" style={{ marginBottom: 8 }}>
                  The concentric rings are reference cosine values, aligned with
                  the inbox threshold presets in Settings:
                </Text>
                {MatchingConfig.mapReferenceRings.similarities.map((sim) => (
                  <Text key={`legend-${sim}`} variant="bodyMedium" style={{ marginLeft: 12 }}>
                    {`• sim ${sim.toFixed(2)} — `}
                    {sim >= 0.85
                      ? 'near-identical interests'
                      : sim >= 0.7
                        ? 'strongly related'
                        : sim >= 0.5
                          ? 'sharing a clear theme'
                          : 'loosely related'}
                  </Text>
                ))}
                <Text variant="bodyMedium" style={{ marginTop: 8, marginBottom: 8 }}>
                  <Text style={{ fontWeight: '700' }}>The angle has no precise
                  meaning.</Text>{' '}
                  Only the distance from the centre is exact (how similar a post
                  is to yours). The angle is a weak, approximate hint: posts that
                  resemble <Text style={{ fontStyle: 'italic' }}>each other</Text>{' '}
                  tend to fall in the same direction, so a wedge loosely groups
                  related peers — but there is no labelled axis, and two posts at
                  the same angle share no fixed "topic". For named groups, use the
                  global topic map instead.
                </Text>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  Pinch to zoom. Drag to pan. Tap any star to read.
                </Text>
              </>
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setInfoOpen(false)}>Got it</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

function MapHeader(props: {
  peerCount: number;
  hasPeers: boolean;
  selfLabel: string;
  onBack: () => void;
  onInfo: () => void;
}) {
  const theme = useTheme();
  const { peerCount, hasPeers, selfLabel, onBack, onInfo } = props;
  return (
    <Surface
      style={{
        padding: 8,
        paddingRight: 4,
        backgroundColor: theme.colors.surface,
        flexDirection: 'row',
        alignItems: 'center',
      }}
      elevation={2}
    >
      <IconButton icon="arrow-left" size={22} onPress={onBack} accessibilityLabel="Back" />
      <View style={{ flex: 1 }}>
        <Text variant="labelLarge" style={{ color: theme.colors.onSurface }}>
          {`You · ${selfLabel}`}
        </Text>
        <Text
          variant="bodySmall"
          style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}
          numberOfLines={2}
        >
          {hasPeers
            ? `${peerCount} ${peerCount === 1 ? 'post' : 'posts'} in your local room view — tap a point to read.`
            : 'No posts in view yet — yours is broadcasting to the room.'}
        </Text>
      </View>
      <IconButton
        icon="information-outline"
        size={22}
        onPress={onInfo}
        accessibilityLabel="How to read the map"
      />
    </Surface>
  );
}

function MapLegendBar(props: { visible: boolean; onReset: () => void }) {
  const theme = useTheme();
  const { visible, onReset } = props;
  if (!visible) {
    return null;
  }
  return (
    <Surface
      elevation={2}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: theme.colors.surface,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text
          variant="labelSmall"
          style={{ color: theme.colors.onSurfaceVariant, marginBottom: 4 }}
        >
          Distance from your star = how similar
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text variant="labelSmall" style={{ color: theme.colors.onSurface }}>
            ●
          </Text>
          <View
            style={{
              flex: 1,
              height: 4,
              marginHorizontal: 8,
              borderRadius: 2,
              backgroundColor: ThemeConfig.map.peerStarColorHigh,
            }}
          />
          <View
            style={{
              flex: 1,
              height: 4,
              marginHorizontal: 8,
              borderRadius: 2,
              backgroundColor: ThemeConfig.map.peerStarColorLow,
            }}
          />
          <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
            ○
          </Text>
        </View>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            marginTop: 2,
          }}
        >
          <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
            close · similar
          </Text>
          <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
            far · unrelated
          </Text>
        </View>
      </View>
      <IconButton
        icon="restore"
        mode="contained-tonal"
        onPress={onReset}
        accessibilityLabel="Reset view"
        style={{ marginLeft: 8 }}
      />
    </Surface>
  );
}

function SelectedSheet(props: {
  selected: SelectedPoint;
  bottomOffset: number;
  onClose: () => void;
  onOpenThread: () => void;
}) {
  const theme = useTheme();
  const { selected, onClose, onOpenThread, bottomOffset } = props;
  return (
    <Surface
      style={{
        position: 'absolute',
        bottom: bottomOffset,
        left: 12,
        right: 12,
        padding: 16,
        backgroundColor: theme.colors.surface,
        borderRadius: 16,
      }}
      elevation={4}
    >
      <Text variant="labelLarge" style={{ color: theme.colors.onSurfaceVariant }}>
        {selected.isAnchor ? 'Your post' : shortPeer(selected.author)}
        {selected.isAnchor ? '' : `  ·  sim ${selected.similarity.toFixed(2)}`}
      </Text>
      <ScrollView style={{ maxHeight: 180, marginTop: 6 }}>
        <Text variant="bodyMedium" style={{ color: theme.colors.onSurface }}>
          {selected.text}
        </Text>
      </ScrollView>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 }}>
        <Button onPress={onClose}>Close</Button>
        <Button mode="contained" onPress={onOpenThread} style={{ marginLeft: 8 }}>
          Open thread
        </Button>
      </View>
    </Surface>
  );
}

function clamp(v: number, min: number, max: number): number {
  if (v < min) {
    return min;
  }
  if (v > max) {
    return max;
  }
  return v;
}

function fillCentered(background: string) {
  return {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: background,
    padding: 24,
  };
}

/**
 * Span of the SVG viewBox (`-1.05 -1.05 2.1 2.1`). The pixel→viewBox tap math
 * divides the measured side by exactly this, so the two never drift.
 */
const MAP_VIEWBOX_SPAN = 2.1;

/** Grid tick positions for the cartesian (PCA-2) view, in viewBox units. */
const GRID_TICKS = [-1, -0.75, -0.5, -0.25, 0.25, 0.5, 0.75, 1] as const;

/**
 * Resolve a default map anchor when the screen is opened without an explicit
 * post: prefer the user's most recent own post, else the best-scoring inbox
 * post, else none (caller shows an empty-state message).
 */
async function resolveDefaultAnchor(
  container: ReturnType<typeof useRequireContainer>,
): Promise<RecordAddress | null> {
  const own = await container.database.query<{ address: string }>(
    'SELECT address FROM posts WHERE author = ? ORDER BY created_at DESC LIMIT 1',
    [container.self],
  );
  if (own.length > 0) {
    return own[0].address as RecordAddress;
  }
  const remote = await container.database.query<{ address: string }>(
    'SELECT address FROM posts WHERE author != ? AND similarity IS NOT NULL ORDER BY similarity DESC LIMIT 1',
    [container.self],
  );
  if (remote.length > 0) {
    return remote[0].address as RecordAddress;
  }
  return null;
}
