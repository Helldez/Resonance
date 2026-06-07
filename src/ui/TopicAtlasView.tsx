import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  View,
  ScrollView,
  Pressable,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, G } from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useRequireContainer } from '@ui/AppContainerContext';
import { useSettingsStore } from '@domain/SettingsStore';
import { MatchingConfig } from '@core/config/MatchingConfig';
import { TopicConfig } from '@core/config/TopicConfig';
import { ThemeConfig } from '@core/config/ThemeConfig';
import { DesignTokens as T } from '@core/config/DesignTokens';
import { Button, IconButton, Text, TopBar } from '@ui/design-system';
import { computeTopicAtlas } from '@core/topics/TopicAtlas';
import type { TopicAtlasResult, AtlasTopic } from '@core/topics/TopicAtlas';
import { nameTopics } from '@core/topics/NameTopics';
import { shortPeer } from '@domain/AuthorFormatting';
import type { PeerId, RecordAddress } from '@core/domain/types';

// The map viewBox is 2.1 units wide/tall; `preserveAspectRatio=meet` fits it
// into the smaller screen dimension. This factor converts a viewBox unit to
// on-screen pixels, so label font size and gaps can be kept at a constant
// pixel size regardless of zoom.
const VIEWBOX_SPAN = 2.1;

interface SelectedPoint {
  readonly address: RecordAddress;
  readonly author: PeerId;
  readonly text: string;
  readonly isOwn: boolean;
  readonly topicLabel: string;
  /** Atlas coordinates, so the map can ring the selected dot. */
  readonly x: number;
  readonly y: number;
}

/** Stable, well-spread hue per topic. */
function topicColor(id: number, k: number): string {
  const hue = k > 0 ? Math.round((id * 360) / k) : 0;
  return `hsl(${hue}, 65%, 60%)`;
}

function legendChipStyle() {
  return {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: T.color.bgElevated,
    borderRadius: T.radius.pill,
    paddingHorizontal: T.space.md - T.space.xxs,
    paddingVertical: T.space.xs + 1,
    marginRight: T.space.sm,
  };
}

function legendSwatchStyle(color: string) {
  return {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 6,
    backgroundColor: color,
  };
}

export function TopicAtlasView() {
  const container = useRequireContainer();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const threshold = useSettingsStore((s) => s.similarityThreshold);
  const { width, height } = useWindowDimensions();

  const [atlas, setAtlas] = useState<TopicAtlasResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedPoint | null>(null);
  const [selectedTopic, setSelectedTopic] = useState<AtlasTopic | null>(null);

  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [scale, setScale] = useState(1);
  const txRef = useRef(0);
  const tyRef = useRef(0);
  const scaleRef = useRef(1);
  useEffect(() => { txRef.current = tx; }, [tx]);
  useEffect(() => { tyRef.current = ty; }, [ty]);
  useEffect(() => { scaleRef.current = scale; }, [scale]);
  const panStartRef = useRef<{ tx: number; ty: number } | null>(null);
  const scaleStartRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const dim = MatchingConfig.embeddingDim;
        const rows = await container.posts.listForMap(
          container.self,
          TopicConfig.maxPosts,
          dim,
          { includeSelf: true, minSimilarity: threshold },
        );
        if (cancelled) return;
        const posts = rows.map((r) => ({
          address: r.address,
          author: r.author,
          text: r.text,
          embedding: r.embedding,
          isOwn: r.author === container.self,
        }));
        const result = await computeTopicAtlas(posts);
        if (cancelled) return;
        setAtlas(result);

        // Best-effort LLM naming — only if the model is already loaded, and
        // never blocking the map. Patches topic labels in place; the medoid
        // labels stand if it fails or the model is absent.
        if (container.llmConcrete.isLoaded && result.topics.length > 0) {
          const names = await nameTopics(
            { llm: container.llm },
            {
              clusters: result.topics.map((t) => ({
                topicId: t.id,
                centralTexts: t.centralTexts,
              })),
            },
          ).catch(() => []);
          if (cancelled || names.length === 0) return;
          const byId = new Map(names.map((nm) => [nm.topicId, nm.name]));
          setAtlas((prev) =>
            prev === null
              ? prev
              : {
                  ...prev,
                  topics: prev.topics.map((t) =>
                    byId.has(t.id) ? { ...t, label: byId.get(t.id) as string } : t,
                  ),
                },
          );
        }
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [container, threshold]);

  const [svgLayout, setSvgLayout] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const onSvgLayout = (e: LayoutChangeEvent): void => {
    const { x, y, width: w, height: h } = e.nativeEvent.layout;
    setSvgLayout((prev) =>
      prev !== null && prev.x === x && prev.y === y && prev.width === w && prev.height === h
        ? prev
        : { x, y, width: w, height: h },
    );
  };
  const containerW = svgLayout?.width ?? width;
  const containerH = svgLayout?.height ?? Math.max(1, height - 200);
  const pxPerUnit = Math.min(containerW, containerH) / VIEWBOX_SPAN;
  // Tap coordinates: on native, gesture-handler reports e.x/e.y relative to an
  // outer ancestor, so add the inner View's layout offset to align the SVG
  // centre with its visual midpoint; on web they are already target-relative.
  const useOuterOffset = Platform.OS !== 'web';
  const offsetX = useOuterOffset ? svgLayout?.x ?? 0 : 0;
  const offsetY = useOuterOffset ? svgLayout?.y ?? 0 : 0;
  const svgCenterX = offsetX + containerW / 2;
  const svgCenterY = offsetY + containerH / 2;

  // Refs so the stable Tap gesture reads the latest projection without being
  // re-created on every pan/pinch frame (recreating it drops in-flight taps).
  const atlasRef = useRef<TopicAtlasResult | null>(atlas);
  useEffect(() => {
    atlasRef.current = atlas;
  }, [atlas]);
  const pxPerUnitRef = useRef(pxPerUnit);
  useEffect(() => {
    pxPerUnitRef.current = pxPerUnit;
  }, [pxPerUnit]);
  const svgCenterXRef = useRef(svgCenterX);
  useEffect(() => {
    svgCenterXRef.current = svgCenterX;
  }, [svgCenterX]);
  const svgCenterYRef = useRef(svgCenterY);
  useEffect(() => {
    svgCenterYRef.current = svgCenterY;
  }, [svgCenterY]);

  const gesture = useMemo(() => {
    // Manual hit-test, mirroring the per-post map. SVG <Circle onPress> alone
    // is unreliable on Android inside a GestureDetector — the pan recogniser
    // swallows the touch before onPress fires, so dots looked untappable.
    const tap = Gesture.Tap()
      .maxDuration(500)
      .maxDistance(14)
      .numberOfTaps(1)
      .shouldCancelWhenOutside(false)
      .onEnd((e, success) => {
        if (!success) {
          return;
        }
        const a = atlasRef.current;
        if (a === null) {
          return;
        }
        const ppu = pxPerUnitRef.current;
        const s = scaleRef.current;
        const localX = ((e.x - svgCenterXRef.current) / ppu - txRef.current) / s;
        const localY = ((e.y - svgCenterYRef.current) / ppu - tyRef.current) / s;
        const hr = 16 / ppu / s;
        const hrSq = hr * hr;

        let bestP: TopicAtlasResult['points'][number] | null = null;
        let bestSq = Infinity;
        for (const p of a.points) {
          const dx = p.x - localX;
          const dy = p.y - localY;
          const sq = dx * dx + dy * dy;
          if (sq <= hrSq && sq < bestSq) {
            bestSq = sq;
            bestP = p;
          }
        }
        if (bestP !== null) {
          const p = bestP;
          setSelectedTopic(null);
          setSelected({
            address: p.address,
            author: p.author,
            text: p.text,
            isOwn: p.isOwn,
            topicLabel: a.topics[p.topicId]?.label ?? '',
            x: p.x,
            y: p.y,
          });
          return;
        }
        // No dot under the finger — fall back to the enclosing topic bubble.
        for (const t of a.topics) {
          const dx = t.cx - localX;
          const dy = t.cy - localY;
          if (dx * dx + dy * dy <= t.r * t.r) {
            setSelected(null);
            setSelectedTopic(t);
            return;
          }
        }
      });

    const pan = Gesture.Pan()
      .minDistance(6)
      .onStart(() => {
        panStartRef.current = { tx: txRef.current, ty: tyRef.current };
      })
      .onUpdate((e) => {
        const start = panStartRef.current;
        if (start === null) return;
        setTx(start.tx + e.translationX / pxPerUnit);
        setTy(start.ty + e.translationY / pxPerUnit);
      })
      .onEnd(() => {
        panStartRef.current = null;
      });
    const pinch = Gesture.Pinch()
      .onStart(() => {
        scaleStartRef.current = scaleRef.current;
      })
      .onUpdate((e) => {
        const start = scaleStartRef.current;
        if (start === null) return;
        const next = Math.min(
          MatchingConfig.mapZoomMax,
          Math.max(MatchingConfig.mapZoomMin, start * e.scale),
        );
        setScale(next);
      })
      .onEnd(() => {
        scaleStartRef.current = null;
      });
    return Gesture.Simultaneous(pinch, Gesture.Race(tap, pan));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pxPerUnit]);

  // Constant on-screen sizes expressed in viewBox units, so dots, the
  // selection ring and bubble strokes keep a fixed pixel size at any zoom.
  const dotHitR = 16 / pxPerUnit / scale;
  const strokeUnit = (px: number): number => px / pxPerUnit / scale;

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: ThemeConfig.map.backgroundColor,
        paddingBottom: insets.bottom,
      }}
    >
      <TopBar
        title="Atlas"
        subtitle={
          atlas === null
            ? 'Projecting…'
            : `${atlas.k} ${atlas.k === 1 ? 'topic' : 'topics'} · ${atlas.points.length} posts · tap a dot to read`
        }
      />

      {loadError !== null && (
        <Text variant="small" color={T.color.danger} style={{ padding: T.space.sm }}>
          {loadError}
        </Text>
      )}

      <GestureDetector gesture={gesture}>
        <View style={{ flex: 1 }} onLayout={onSvgLayout}>
          <Svg width="100%" height="100%" viewBox="-1.05 -1.05 2.1 2.1" preserveAspectRatio="xMidYMid meet">
            <G transform={`translate(${tx} ${ty}) scale(${scale})`}>
              {atlas !== null &&
                atlas.topics.map((t) => {
                  const color = topicColor(t.id, atlas.k);
                  return (
                    <Circle
                      key={`bubble-${t.id}`}
                      cx={t.cx}
                      cy={t.cy}
                      r={t.r}
                      fill={color}
                      fillOpacity={0.08}
                      stroke={color}
                      strokeWidth={strokeUnit(1.5)}
                      strokeOpacity={0.5}
                    />
                  );
                })}

              {/* Bubble-level click target (tap empty bubble area → its name).
                  Rendered under the dots so a dot tap wins. */}
              {atlas !== null &&
                atlas.topics.map((t) => (
                  <Circle
                    key={`bubblehit-${t.id}`}
                    cx={t.cx}
                    cy={t.cy}
                    r={t.r}
                    fill={topicColor(t.id, atlas.k)}
                    opacity={0}
                    onPress={() => {
                      setSelected(null);
                      setSelectedTopic(t);
                    }}
                  />
                ))}

              {atlas !== null &&
                atlas.points.map((p) => (
                  <Circle
                    key={`dot-${p.address}`}
                    cx={p.x}
                    cy={p.y}
                    r={(p.isOwn ? 4.5 : 3.5) / pxPerUnit / scale}
                    fill={p.isOwn ? ThemeConfig.map.selfStarColor : topicColor(p.topicId, atlas.k)}
                  />
                ))}

              {/* Selection ring: shows exactly which dot was tapped. Drawn
                  under the hit layer (fill none → never intercepts taps). */}
              {selected !== null && (
                <Circle
                  cx={selected.x}
                  cy={selected.y}
                  r={9 / pxPerUnit / scale}
                  fill="none"
                  stroke={ThemeConfig.map.peerStarSelectedColor}
                  strokeWidth={strokeUnit(2)}
                />
              )}

              {/* Per-point click targets on top (reliable native hit-test). */}
              {atlas !== null &&
                atlas.points.map((p) => (
                  <Circle
                    key={`hit-${p.address}`}
                    cx={p.x}
                    cy={p.y}
                    r={dotHitR}
                    fill={ThemeConfig.map.peerStarColorLow}
                    opacity={0}
                    onPress={() => {
                      setSelectedTopic(null);
                      setSelected({
                        address: p.address,
                        author: p.author,
                        text: p.text,
                        isOwn: p.isOwn,
                        topicLabel: atlas.topics[p.topicId]?.label ?? '',
                        x: p.x,
                        y: p.y,
                      });
                    }}
                  />
                ))}
            </G>
          </Svg>
        </View>
      </GestureDetector>

      {/* Legend: one chip per topic (its colour + name), plus the "You"
          swatch. Tapping a chip opens that topic. This replaces the on-map
          text labels, which overlapped and were hard to read. */}
      <View
        style={{
          backgroundColor: T.color.bg,
          paddingVertical: T.space.xs,
          borderTopWidth: 1,
          borderTopColor: T.color.border,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: T.space.md, alignItems: 'center' }}
            style={{ flex: 1 }}
          >
            <View style={legendChipStyle()}>
              <View style={legendSwatchStyle(ThemeConfig.map.selfStarColor)} />
              <Text variant="caption" color={T.color.text}>
                You
              </Text>
            </View>
            {atlas?.topics.map((t) => (
              <Pressable
                key={`legend-${t.id}`}
                onPress={() => {
                  setSelected(null);
                  setSelectedTopic(t);
                }}
                style={legendChipStyle()}
              >
                <View style={legendSwatchStyle(topicColor(t.id, atlas.k))} />
                <Text variant="caption" color={T.color.text}>
                  {t.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <IconButton
            icon="refresh"
            accessibilityLabel="Reset view"
            onPress={() => {
              setTx(0);
              setTy(0);
              setScale(1);
            }}
          />
        </View>
      </View>

      {selectedTopic !== null && (
        <View style={panelStyle(insets.bottom)}>
          <Text variant="caption">
            {`Topic · ${selectedTopic.count} ${selectedTopic.count === 1 ? 'post' : 'posts'}`}
          </Text>
          <ScrollView style={{ maxHeight: 160, marginTop: T.space.xs }}>
            <Text variant="body">{selectedTopic.labelFull}</Text>
          </ScrollView>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: T.space.md }}>
            <Button label="Close" variant="ghost" small onPress={() => setSelectedTopic(null)} />
          </View>
        </View>
      )}

      {selected !== null && (
        <View style={panelStyle(insets.bottom)}>
          <Text variant="caption">
            {selected.isOwn ? 'Your post' : shortPeer(selected.author)}
            {selected.topicLabel.length > 0 ? `  ·  ${selected.topicLabel}` : ''}
          </Text>
          <ScrollView style={{ maxHeight: 160, marginTop: T.space.xs }}>
            <Text variant="body">{selected.text}</Text>
          </ScrollView>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'flex-end',
              gap: T.space.sm,
              marginTop: T.space.md,
            }}
          >
            <Button label="Close" variant="ghost" small onPress={() => setSelected(null)} />
            <Button
              label="Open thread"
              small
              onPress={() => {
                const target = selected.address;
                setSelected(null);
                router.push({ pathname: '/thread/[id]', params: { id: target } });
              }}
            />
          </View>
        </View>
      )}
    </View>
  );
}

/** Floating detail panel above the legend: elevated surface, hairline border. */
function panelStyle(bottomInset: number) {
  return {
    position: 'absolute' as const,
    bottom: bottomInset + 96,
    left: T.space.md,
    right: T.space.md,
    padding: T.space.lg,
    backgroundColor: T.color.bgElevated,
    borderRadius: T.radius.lg,
    borderWidth: 1,
    borderColor: T.color.border,
  };
}
