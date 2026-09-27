import { CircleAlert, CircleCheck, LoaderCircle, X } from "lucide-react";
import { useId, type FC } from "react";

import { formatQuantity } from "@/shared/lib/format";
import { LinkButton } from "@/shared/ui";

import { TILE_ACCEPT } from "../lib/check-tile";
import { formatBytes } from "../lib/format-bytes";
import type { TileFilesState } from "../model/use-tile-files";
import { FileDropZone } from "./file-drop-zone";

type TileSummaryProps = { tiles: TileFilesState };

const TileSummary: FC<TileSummaryProps> = ({ tiles }) => {
  if (tiles.tiles.length === 0 && tiles.problems.length === 0) return null;

  return (
    <div className="border-border grid gap-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm">
          <CircleCheck className="text-primary size-4" aria-hidden />
          <span className="font-medium tabular-nums">{formatQuantity(tiles.tiles.length, "tile", "tiles")}</span>
          <span className="text-muted-foreground tabular-nums">{formatBytes(tiles.totalBytes)}</span>
        </p>
        <LinkButton onClick={tiles.clear} className="text-xs">
          Remove all
        </LinkButton>
      </div>
      {tiles.problems.length > 0 && (
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-destructive flex items-center gap-2 text-sm">
              <CircleAlert className="size-4" aria-hidden />
              {formatQuantity(tiles.problems.length, "file is", "files are")} not a usable tile
            </p>
            <LinkButton onClick={tiles.removeProblems} className="text-xs">
              Remove these
            </LinkButton>
          </div>
          <ul className="divide-border max-h-40 divide-y overflow-y-auto rounded-md border text-xs">
            {tiles.problems.map(({ file, check }, index) => (
              <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-3 px-2.5 py-1.5">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{file.name}</span>
                  <span className="text-destructive">{check.status === "invalid" ? check.message : ""}</span>
                </span>
                <button
                  type="button"
                  onClick={() => tiles.removeTile(file.name)}
                  aria-label={`Remove ${file.name}`}
                  className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 grid size-6 shrink-0 place-items-center rounded-md outline-none focus-visible:ring-[3px]"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

type TilesFieldProps = { tiles: TileFilesState };

export const TilesField: FC<TilesFieldProps> = ({ tiles }) => {
  const hintId = useId();

  return (
    <fieldset className="grid gap-4">
      <legend className="mb-1 text-[0.9375rem] font-semibold">
        Image tiles <span className="text-muted-foreground font-normal">(required)</span>
      </legend>
      <p id={hintId} className="text-muted-foreground -mt-2 text-sm leading-relaxed">
        The drone survey&rsquo;s GeoTIFF tiles, unchanged and with their original names, for example
        siret3_r005_c004.tif. The processing service checks their coordinate system and resolution and turns them into
        canopies, rows, inter-rows, waste and measurements.
      </p>
      <FileDropZone
        prompt="Drop the image tiles here"
        accept={TILE_ACCEPT}
        describedBy={hintId}
        onFiles={files => void tiles.addFiles(files)}
      />
      <div aria-live="polite" className="grid gap-3">
        {tiles.isChecking && (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
            Checking the tiles
          </p>
        )}
        <TileSummary tiles={tiles} />
      </div>
    </fieldset>
  );
};
