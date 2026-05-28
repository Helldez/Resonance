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
import { MatchingConfig } from '@core/config/MatchingConfig';
import { ThemeConfig } from '@core/config/ThemeConfig';
import { formatAuthor, shortPeer } from '@domain/AuthorFormatting';
import { clamp01, interpolateColor } from '@ui/colorMath';
import type { PeerId, RecordAddress } from '@core/domain/types';

interface SelectedPoint {
  readonly address: RecordAddress;
  readonly author: PeerId;
  readonly text: string;
  readonly similarity: number;
  readonly isAnchor: boolean;
}

export default function MapScreen() {
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
    if (typeof anchorParam !== 'string' || anchorParam.length === 0) {
      setLoadError('Missing anchor address');
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const result = await getMapView(
          { posts: container.posts, self: container.self },
          anchorParam as RecordAddress,
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
  }, [anchorParam, container.posts, container.self]);

  // Conversion factor in pixels per viewBox unit. The SVG uses
  // `preserveAspectRatio="xMidYMid meet"` with a 2.4×2.4 viewBox inside
  // the measured `svgLayout`; the smaller of width/height drives the
  // scale, the larger gets padded by SVG's intrinsic centering.
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
  const sideUnits = Math.min(containerW, containerH) / 2.4;
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
  const anchorRadius = ThemeConfig.map.selfStarRadiusPx / sideUnits / scale;
  const anchorOuterRadius = ThemeConfig.map.selfStarOuterRadiusPx / sideUnits / scale;
  const labelFontSize = 12 / sideUnits / scale;
  const ringStrokeWidth =
    ThemeConfig.map.referenceRingStrokeWidthPx / sideUnits / scale;
  const ringLabelFontSize = 10 / sideUnits / scale;

  const topLabeled = new Set<string>();
  const sortedBySim = [...peers].sort(
    (a, b) => b.plot.similarityToAnchor - a.plot.similarityToAnchor,
  );
  const labelMax = Math.min(MatchingConfig.mapLabelTopK, sortedBySim.length);
  for (let i = 0; i < labelMax; i++) {
    const p = sortedBySim[i];
    if (p.plot.similarityToAnchor >= MatchingConfig.mapLabelMinSimilarity) {
      topLabeled.add(p.address);
    }
  }

  const radialMode = MatchingConfig.mapProjectionMethod === 'radial-sim';
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
        r: (1 - sim) / 2,
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

              {peers.map((p) => {
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
                const color = isSelected
                  ? ThemeConfig.map.peerStarSelectedColor
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

              {/* In radial-sim mode the distance already encodes similarity,
                  so numeric labels on each peer would be redundant and clutter
                  the view. The exact value is still shown in the bottom sheet
                  when a star is tapped. */}
              {!radialMode &&
                peers.map((p) => {
                  if (!topLabeled.has(p.address)) {
                    return null;
                  }
                  return (
                    <SvgText
                      key={`label-${p.address}`}
                      x={p.plot.x + peerRadiusSelected * 1.4}
                      y={p.plot.y - peerRadiusSelected * 0.4}
                      fontSize={labelFontSize}
                      fill={theme.colors.onSurface}
                      opacity={0.9}
                    >
                      {p.plot.similarityToAnchor.toFixed(2)}
                    </SvgText>
                  );
                })}

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
            <Text variant="bodyMedium" style={{ marginBottom: 8 }}>
              The bright white star at the center is your anchor post.
            </Text>
            <Text variant="bodyMedium" style={{ marginBottom: 8 }}>
              Every other star is a recent post from a peer.{' '}
              <Text style={{ fontWeight: '700' }}>
                Distance from the center = semantic similarity.
              </Text>{' '}
              Closer to center means more affine; near the edge means unrelated.
            </Text>
            <Text variant="bodyMedium" style={{ marginBottom: 8 }}>
              The concentric rings are reference cosine values, aligned with the
              inbox threshold presets in Settings:
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
              The dashed purple ring marks{' '}
              <Text style={{ fontWeight: '700' }}>your active inbox threshold</Text>.
              Stars inside it pass your filter; stars outside it are dropped.
            </Text>
            <Text variant="bodyMedium" style={{ marginBottom: 8 }}>
              <Text style={{ fontWeight: '700' }}>Angle around the center has no
              semantic meaning</Text> in this view — it is only used to spread the
              points so they do not overlap. Two stars at the same angle are NOT
              more related to each other than two at opposite angles; only the
              distance from the center matters.
            </Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
              Pinch to zoom. Drag to pan. Tap any star to read.
            </Text>
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
            ? `${peerCount} nearby ${peerCount === 1 ? 'post' : 'posts'} — closer = more similar. Tap a star to read.`
            : 'No peers in range yet — your post is now broadcasting.'}
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
