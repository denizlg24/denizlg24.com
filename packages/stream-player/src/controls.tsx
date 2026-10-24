import type { Episode, TextTrack } from "@repo/schemas/stream";
import {
  Airplay,
  ArrowLeft,
  AudioLines,
  Captions,
  Cast,
  Gauge,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  RotateCw,
  SkipForward,
} from "lucide-react";
import type { ReactNode, Ref } from "react";
import { ControlButton } from "./control-button";
import { SEEK_STEP_S } from "./keyboard";
import { episodeLabel, languageName, rateLabel } from "./labels";
import { PlayerMenu } from "./menu";
import { SeekBar } from "./seek-bar";
import { cx, iconSize } from "./styles";
import { formatTime } from "./time";
import type { Player } from "./use-player";
import { VolumeControl } from "./volume";

export type MenuId = "captions" | "audio" | "speed" | "quality";

interface ChromeLayerProps {
  visible: boolean;
  onHover: (hovering: boolean) => void;
  children: ReactNode;
  edge: "top" | "bottom";
}

function ChromeLayer({ visible, onHover, children, edge }: ChromeLayerProps) {
  return (
    <div
      className={cx(
        "pointer-events-none absolute inset-x-0 z-20 transition-opacity duration-300",
        edge === "top" ? "top-0" : "bottom-0",
        visible ? "opacity-100" : "opacity-0",
      )}
    >
      <div
        aria-hidden="true"
        className={cx(
          "absolute inset-x-0 from-black/85 via-black/40 to-transparent",
          edge === "top"
            ? "top-0 h-36 bg-linear-to-b lg:h-48"
            : "bottom-0 h-52 bg-linear-to-t lg:h-72",
        )}
      />
      <div
        className={cx(
          "relative px-4 sm:px-8 lg:px-12",
          edge === "top" ? "pt-4 sm:pt-6 lg:pt-10" : "pb-3 sm:pb-5 lg:pb-10",
          visible ? "pointer-events-auto" : "pointer-events-none",
        )}
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") onHover(true);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse") onHover(false);
        }}
      >
        {children}
      </div>
    </div>
  );
}

export interface TopBarProps {
  visible: boolean;
  title: string;
  subtitle: string | null;
  onBack?: () => void;
  backRef?: Ref<HTMLButtonElement>;
  onHover: (hovering: boolean) => void;
}

export function TopBar({
  visible,
  title,
  subtitle,
  onBack,
  backRef,
  onHover,
}: TopBarProps) {
  return (
    <ChromeLayer visible={visible} onHover={onHover} edge="top">
      <div className="flex items-center gap-3 lg:gap-5">
        {onBack && (
          <ControlButton ref={backRef} label="Back" onClick={onBack}>
            <ArrowLeft className={iconSize} />
          </ControlButton>
        )}
        <div className="min-w-0">
          <h1 className="truncate font-semibold text-lg text-white drop-shadow-md sm:text-xl lg:text-3xl">
            {title}
          </h1>
          {subtitle && (
            <p className="truncate text-sm text-white/70 sm:text-base lg:text-xl">
              {subtitle}
            </p>
          )}
        </div>
      </div>
    </ChromeLayer>
  );
}

export function SkipIcon({
  direction,
  seconds = SEEK_STEP_S,
}: {
  direction: "back" | "forward";
  seconds?: number;
}) {
  const Icon = direction === "back" ? RotateCcw : RotateCw;
  return (
    <span className="relative inline-flex">
      <Icon className={iconSize} />
      <span className="absolute inset-0 flex items-center justify-center pt-px font-semibold text-[8px] tabular-nums sm:text-[9px] lg:text-[10px]">
        {seconds}
      </span>
    </span>
  );
}

export interface BottomBarProps {
  player: Player;
  visible: boolean;
  textTracks: readonly TextTrack[];
  next: Episode | null;
  onNext?: (episode: Episode) => void;
  openMenu: MenuId | null;
  onMenu: (menu: MenuId | null) => void;
  onScrubChange: (scrubbing: boolean) => void;
  onHover: (hovering: boolean) => void;
  playRef: Ref<HTMLButtonElement>;
}

export function BottomBar({
  player,
  visible,
  textTracks,
  next,
  onNext,
  openMenu,
  onMenu,
  onScrubChange,
  onHover,
  playRef,
}: BottomBarProps) {
  const { media, hasMedia, actions } = player;
  const playing = hasMedia && !media.paused && !media.ended;
  const menuProps = (id: MenuId) => ({
    open: openMenu === id,
    onOpenChange: (open: boolean) => onMenu(open ? id : null),
  });

  const captionItems = [
    { value: "-1", label: "Off" },
    ...textTracks.map((track, index) => ({
      value: String(index),
      label:
        track.label || languageName(track.language) || `Track ${index + 1}`,
    })),
  ];
  const captionsOn = player.captionIndex >= 0;
  const quality = player.source?.height;

  return (
    <ChromeLayer visible={visible} onHover={onHover} edge="bottom">
      <div className="flex items-center gap-3 text-sm text-white/80 tabular-nums sm:gap-4 sm:text-base lg:text-xl">
        <span className="min-w-12 text-right">
          {formatTime(media.currentTime, media.duration)}
        </span>
        <SeekBar
          currentTime={media.currentTime}
          duration={media.duration}
          buffered={media.buffered}
          disabled={!hasMedia}
          onSeek={actions.seekTo}
          onScrubChange={onScrubChange}
        />
        <span className="min-w-12">{formatTime(media.duration)}</span>
      </div>

      <div className="mt-1 flex items-center justify-between gap-2 lg:mt-3">
        <div className="flex items-center gap-1 sm:gap-2">
          <ControlButton
            ref={playRef}
            label={playing ? "Pause" : "Play"}
            disabled={!hasMedia}
            onClick={actions.togglePlay}
          >
            {playing ? (
              <Pause className={cx(iconSize, "fill-white")} />
            ) : (
              <Play className={cx(iconSize, "fill-white")} />
            )}
          </ControlButton>
          <ControlButton
            label={`Back ${SEEK_STEP_S} seconds`}
            disabled={!hasMedia}
            onClick={() => actions.seekBy(-SEEK_STEP_S)}
          >
            <SkipIcon direction="back" />
          </ControlButton>
          <ControlButton
            label={`Forward ${SEEK_STEP_S} seconds`}
            disabled={!hasMedia}
            onClick={() => actions.seekBy(SEEK_STEP_S)}
          >
            <SkipIcon direction="forward" />
          </ControlButton>
          <VolumeControl
            volume={media.volume}
            muted={media.muted}
            disabled={!hasMedia}
            onVolume={actions.setVolume}
            onToggleMute={actions.toggleMute}
          />
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          {next && (
            <ControlButton
              label={`Next episode: ${episodeLabel(next)}`}
              disabled={!onNext}
              onClick={() => onNext?.(next)}
              wide
            >
              <SkipForward className={cx(iconSize, "fill-white")} />
              <span className="hidden font-medium text-sm md:inline lg:text-lg">
                Next episode
              </span>
            </ControlButton>
          )}
          {textTracks.length > 0 && (
            <PlayerMenu
              {...menuProps("captions")}
              label="Subtitles"
              triggerLabel={
                captionsOn
                  ? `Subtitles: ${captionItems[player.captionIndex + 1]?.label}`
                  : "Subtitles: off"
              }
              trigger={
                <>
                  <Captions className={iconSize} />
                  {captionsOn && (
                    <span className="absolute bottom-1.5 h-0.5 w-5 rounded-full bg-white lg:bottom-2 lg:w-6" />
                  )}
                </>
              }
              disabled={!hasMedia || textTracks.length === 0}
              items={captionItems}
              selected={String(player.captionIndex)}
              onSelect={(value) => actions.setCaptions(Number(value))}
            />
          )}
          {player.audioTracks.length > 0 && (
            <PlayerMenu
              {...menuProps("audio")}
              label="Audio"
              trigger={<AudioLines className={iconSize} />}
              disabled={!hasMedia}
              items={player.audioTracks.map((track) => ({
                value: String(track.index),
                label: track.label,
              }))}
              selected={String(player.audioIndex)}
              onSelect={(value) => actions.setAudioTrack(Number(value))}
            />
          )}
          <PlayerMenu
            {...menuProps("speed")}
            label="Playback speed"
            triggerLabel={`Playback speed: ${rateLabel(media.rate)}`}
            trigger={<Gauge className={iconSize} />}
            disabled={!hasMedia}
            items={player.rates.map((rate) => ({
              value: String(rate),
              label: rateLabel(rate),
            }))}
            selected={String(media.rate)}
            onSelect={(value) => actions.setRate(Number(value))}
          />
          {player.qualities.length > 0 && (
            <PlayerMenu
              {...menuProps("quality")}
              label="Quality"
              triggerLabel={`Quality: ${quality ? `${quality}p` : "auto"}`}
              trigger={
                <span className="font-semibold text-xs tabular-nums lg:text-base">
                  {quality ? `${quality}p` : "HD"}
                </span>
              }
              disabled={!hasMedia}
              items={player.qualities.map((option) => ({
                value: String(option.index),
                label: option.label,
              }))}
              selected={String(player.sourceIndex)}
              onSelect={(value) => actions.setSource(Number(value))}
            />
          )}
          {player.castKind && (
            <ControlButton
              label={player.castKind === "airplay" ? "AirPlay" : "Cast"}
              disabled={!hasMedia}
              onClick={actions.cast}
            >
              {player.castKind === "airplay" ? (
                <Airplay className={iconSize} />
              ) : (
                <Cast className={iconSize} />
              )}
            </ControlButton>
          )}
          {player.canPip && (
            <ControlButton
              label={
                player.pip ? "Exit picture in picture" : "Picture in picture"
              }
              disabled={!hasMedia || !player.canPip}
              onClick={actions.togglePip}
            >
              <PictureInPicture2 className={iconSize} />
            </ControlButton>
          )}
          <ControlButton
            label={player.fullscreen ? "Exit full screen" : "Full screen"}
            disabled={!player.canFullscreen}
            onClick={actions.toggleFullscreen}
          >
            {player.fullscreen ? (
              <Minimize className={iconSize} />
            ) : (
              <Maximize className={iconSize} />
            )}
          </ControlButton>
        </div>
      </div>
    </ChromeLayer>
  );
}
