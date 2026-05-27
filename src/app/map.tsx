import { useEffect, useMemo, useState } from 'react';
import { View, useWindowDimensions, ScrollView } from 'react-native';
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

  // Conversion factor: 1 viewBox unit = W / 2.4 pixels when the SVG uses
  // `preserveAspectRatio="xMidYMid meet"` with viewBox of side 2.4 inside
  // a container of width W (taller than wide, portrait). This is the
  // same denominator used to size the circles and labels below.
  const sideUnits = width / 2.4;
  const hitRadiusLocal = ThemeConfig.map.hitRadiusPx / sideUnits / scale;

  const hitTest = (px: number, py: number, source: MapView): SelectedPoint | null => {
    const vbX = (px - width / 2) / sideUnits;
    const vbY = (py - height / 2) / sideUnits;
    const localX = (vbX - tx) / scale;
    const localY = (vbY - ty) / scale;

    let best: { sq: number; pt: SelectedPoint } | null = null;

    const considerAnchor: SelectedPoint = {
      address: source.anchor.address,
      author: source.anchor.author,
      text: source.anchor.text,
      similarity: source.anchor.plot.similarityToAnchor,
      isAnchor: true,
    };
    const dxA = source.anchor.plot.x - localX;
    const dyA = source.anchor.plot.y - localY;
    const sqA = dxA * dxA + dyA * dyA;
    if (sqA <= hitRadiusLocal * hitRadiusLocal) {
      best = { sq: sqA, pt: considerAnchor };
    }

    for (const p of source.peers) {
      const dx = p.plot.x - localX;
      const dy = p.plot.y - localY;
      const sq = dx * dx + dy * dy;
      if (sq <= hitRadiusLocal * hitRadiusLocal) {
        if (best === null || sq < best.sq) {
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
    }
    return best === null ? null : best.pt;
  };

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(8)
        .onStart(() => {
          setPanStart({ tx, ty });
        })
        .onUpdate((e) => {
          if (panStart === null) {
            return;
          }
          const dx = (e.translationX / sideUnits);
          const dy = (e.translationY / sideUnits);
          setTx(panStart.tx + dx);
          setTy(panStart.ty + dy);
        })
        .onEnd(() => {
          setPanStart(null);
        }),
    [panStart, tx, ty, sideUnits],
  );

  const pinchGesture = useMemo(
    () =>
      Gesture.Pinch()
        .onStart(() => {
          setScaleStart(scale);
        })
        .onUpdate((e) => {
          if (scaleStart === null) {
            return;
          }
          const next = clamp(
            scaleStart * e.scale,
            MatchingConfig.mapZoomMin,
            MatchingConfig.mapZoomMax,
          );
          setScale(next);
        })
        .onEnd(() => {
          setScaleStart(null);
        }),
    [scale, scaleStart],
  );

  const tapGesture = useMemo(
    () =>
      Gesture.Tap()
        .maxDistance(8)
        .onEnd((e, success) => {
          if (!success || view === null) {
            return;
          }
          const hit = hitTest(e.x, e.y, view);
          if (hit !== null) {
            setSelected(hit);
          }
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, tx, ty, scale, width, height],
  );

  // Pinch can run with anything (two fingers); tap and pan race because a
  // touch is either a tap (small displacement) or a pan (movement). With
  // Simultaneous they would both fire and the tap would be ignored under
  // a pan claim, which is the bug the user was hitting.
  const composed = useMemo(
    () =>
      Gesture.Simultaneous(pinchGesture, Gesture.Race(tapGesture, panGesture)),
    [panGesture, pinchGesture, tapGesture],
  );

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
  const referenceRings: ReadonlyArray<{ r: number; label: string }> = radialMode
    ? [
        { r: 0.25, label: 'sim 0.5' },
        { r: 0.5, label: 'sim 0.0' },
        { r: 0.75, label: 'sim −0.5' },
      ]
    : [];

  return (
    <View style={{ flex: 1, backgroundColor: ThemeConfig.map.backgroundColor }}>
      <GestureDetector gesture={composed}>
        <View style={{ flex: 1 }}>
          <Svg
            width="100%"
            height="100%"
            viewBox="-1.2 -1.2 2.4 2.4"
            preserveAspectRatio="xMidYMid meet"
          >
            <Rect
              x={-1.2}
              y={-1.2}
              width={2.4}
              height={2.4}
              fill={ThemeConfig.map.backgroundColor}
            />
            <G transform={`translate(${tx} ${ty}) scale(${scale})`}>
              {referenceRings.map((ring) => (
                <Circle
                  key={`ring-${ring.r}`}
                  cx={0}
                  cy={0}
                  r={ring.r}
                  fill="none"
                  stroke={ThemeConfig.map.referenceRingColor}
                  strokeWidth={ringStrokeWidth}
                />
              ))}
              {referenceRings.map((ring) => (
                <SvgText
                  key={`ring-label-${ring.r}`}
                  x={0}
                  y={-ring.r - ringLabelFontSize * 0.4}
                  fontSize={ringLabelFontSize}
                  fill={ThemeConfig.map.referenceRingLabelColor}
                  textAnchor="middle"
                  opacity={0.8}
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

      <Surface
        style={{
          position: 'absolute',
          top: insets.top + 8,
          left: 12,
          right: 12,
          padding: 10,
          paddingRight: 4,
          backgroundColor: theme.colors.surface,
          borderRadius: 12,
          flexDirection: 'row',
          alignItems: 'center',
        }}
        elevation={2}
      >
        <IconButton
          icon="arrow-left"
          size={20}
          onPress={() => router.back()}
          accessibilityLabel="Back"
        />
        <View style={{ flex: 1 }}>
          <Text variant="labelLarge" style={{ color: theme.colors.onSurface }}>
            {`You · ${formatAuthor({
              self: container.self,
              peer: container.self,
              selfDisplayName: displayName,
            })}`}
          </Text>
          <Text
            variant="bodySmall"
            style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}
            numberOfLines={2}
          >
            {hasPeers
              ? `${peers.length} nearby ${peers.length === 1 ? 'post' : 'posts'} — closer = more similar. Tap a star to read.`
              : 'No peers in range yet — your post is now broadcasting.'}
          </Text>
        </View>
        <IconButton
          icon="information-outline"
          size={20}
          onPress={() => setInfoOpen(true)}
          accessibilityLabel="How to read the map"
        />
      </Surface>

      {selected !== null && (
        <SelectedSheet
          selected={selected}
          bottomOffset={insets.bottom + 80}
          onClose={() => setSelected(null)}
          onOpenThread={() => {
            const target = selected.address;
            setSelected(null);
            router.push({ pathname: '/thread/[id]', params: { id: target } });
          }}
        />
      )}

      <IconButton
        icon="restore"
        mode="contained-tonal"
        style={{ position: 'absolute', bottom: insets.bottom + 16, right: 16 }}
        onPress={() => {
          setTx(0);
          setTy(0);
          setScale(1);
        }}
        accessibilityLabel="Reset view"
      />

      {radialMode && (
        <Surface
          elevation={2}
          style={{
            position: 'absolute',
            bottom: insets.bottom + 16,
            left: 16,
            right: 80,
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 12,
            backgroundColor: theme.colors.surface,
          }}
        >
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
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
            <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
              close · similar
            </Text>
            <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
              far · unrelated
            </Text>
          </View>
        </Surface>
      )}

      <Portal>
        <Dialog visible={infoOpen} onDismiss={() => setInfoOpen(false)}>
          <Dialog.Title>How to read this map</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium" style={{ marginBottom: 8 }}>
              The bright white star at the center is your post.
            </Text>
            <Text variant="bodyMedium" style={{ marginBottom: 8 }}>
              Every other star is a recent post from a peer. <Text style={{ fontWeight: '700' }}>The closer to your star, the more semantically similar.</Text>
            </Text>
            <Text variant="bodyMedium" style={{ marginBottom: 8 }}>
              The faint grey circles are reference rings:
            </Text>
            <Text variant="bodyMedium" style={{ marginLeft: 12 }}>
              • inner ring: similarity 0.5
            </Text>
            <Text variant="bodyMedium" style={{ marginLeft: 12 }}>
              • middle ring: similarity 0.0 (unrelated)
            </Text>
            <Text variant="bodyMedium" style={{ marginLeft: 12, marginBottom: 8 }}>
              • outer ring: similarity −0.5 (opposite)
            </Text>
            <Text variant="bodyMedium" style={{ marginBottom: 8 }}>
              Stars at the same angle around your star tend to be similar to
              each other too — the angular ordering follows the structure of
              the candidate set.
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
