/**
 * Compare two PNGs inside a browser page: CIEDE2000 per pixel, an
 * anti-aliasing excuse, and the differing pixels clustered into boxes.
 *
 * Everything runs in the comparator page because that is where a PNG decodes
 * and a canvas exists — no image dependency, and the algorithms are small and
 * specified: CIEDE2000 (Sharma et al. 2005) and pixelmatch's AA heuristic.
 */
export const COMPARE_JS = ({ aData, bData, deltaE, cell, maxPixels, regions = [] }) =>
  new Promise((resolve, reject) => {
    const load = (src) =>
      new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        // Without this a corrupt or oversized data URL hangs the run forever
        // — it did exactly that once.
        img.onerror = () => rej(new Error("image failed to decode"));
        img.src = src;
      });
    Promise.all([load(aData), load(bData)])
      .then(([a, b]) => {
        const width = Math.min(a.width, b.width);
        const height = Math.min(a.height, b.height);
        if (width * height > maxPixels)
          throw new Error(`page too large to compare (${width}x${height})`);
        // Drawn at an OFFSET of its own, so a REGION is compared aligned to
        // its own origin. That is the only thing that separates "identical,
        // 109px lower" from "actually different": the box size and the words
        // say nothing about colour, weight or spacing inside the box.
        const pixels = (img, w, h, ox = 0, oy = 0) => {
          const c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          const ctx = c.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(img, -ox, -oy);
          return ctx.getImageData(0, 0, w, h).data;
        };
        const A = pixels(a, width, height);
        const B = pixels(b, width, height);

        // ── sRGB → CIELAB ────────────────────────────────────────────────
        const toLab = (r, g, bl) => {
          const f = (v) => {
            v /= 255;
            return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
          };
          const [R, G, Bl] = [f(r), f(g), f(bl)];
          // D65
          let x = (R * 0.4124 + G * 0.3576 + Bl * 0.1805) / 0.95047;
          let y = R * 0.2126 + G * 0.7152 + Bl * 0.0722;
          let z = (R * 0.0193 + G * 0.1192 + Bl * 0.9505) / 1.08883;
          const k = (v) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
          [x, y, z] = [k(x), k(y), k(z)];
          return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
        };

        /** CIEDE2000 — the metric looks-same uses; ΔE < ~2.3 is "same colour". */
        const ciede2000 = ([L1, a1, b1], [L2, a2, b2]) => {
          const rad = Math.PI / 180;
          const C1 = Math.hypot(a1, b1);
          const C2 = Math.hypot(a2, b2);
          const Cbar = (C1 + C2) / 2;
          const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
          const ap1 = (1 + G) * a1;
          const ap2 = (1 + G) * a2;
          const Cp1 = Math.hypot(ap1, b1);
          const Cp2 = Math.hypot(ap2, b2);
          const hp = (ap, bp) => {
            if (ap === 0 && bp === 0) return 0;
            const h = Math.atan2(bp, ap) / rad;
            return h >= 0 ? h : h + 360;
          };
          const hp1 = hp(ap1, b1);
          const hp2 = hp(ap2, b2);
          const dLp = L2 - L1;
          const dCp = Cp2 - Cp1;
          let dhp = 0;
          if (Cp1 * Cp2 !== 0) {
            dhp = hp2 - hp1;
            if (dhp > 180) dhp -= 360;
            else if (dhp < -180) dhp += 360;
          }
          const dHp = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dhp * rad) / 2);
          const Lbar = (L1 + L2) / 2;
          const Cpbar = (Cp1 + Cp2) / 2;
          let hbar = hp1 + hp2;
          if (Cp1 * Cp2 !== 0) {
            if (Math.abs(hp1 - hp2) > 180) hbar += hp1 + hp2 < 360 ? 360 : -360;
            hbar /= 2;
          }
          const T =
            1 -
            0.17 * Math.cos((hbar - 30) * rad) +
            0.24 * Math.cos(2 * hbar * rad) +
            0.32 * Math.cos((3 * hbar + 6) * rad) -
            0.2 * Math.cos((4 * hbar - 63) * rad);
          const dTheta = 30 * Math.exp(-(((hbar - 275) / 25) ** 2));
          const Rc = 2 * Math.sqrt(Cpbar ** 7 / (Cpbar ** 7 + 25 ** 7));
          const Sl = 1 + (0.015 * (Lbar - 50) ** 2) / Math.sqrt(20 + (Lbar - 50) ** 2);
          const Sc = 1 + 0.045 * Cpbar;
          const Sh = 1 + 0.015 * Cpbar * T;
          const Rt = -Math.sin(2 * dTheta * rad) * Rc;
          return Math.sqrt(
            (dLp / Sl) ** 2 +
              (dCp / Sc) ** 2 +
              (dHp / Sh) ** 2 +
              Rt * (dCp / Sc) * (dHp / Sh),
          );
        };

        const bright = (d, i) =>
          (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
        /**
         * pixelmatch's anti-aliasing test: an anti-aliased pixel is a local
         * brightness EXTREME among its neighbours. If it is on one side and
         * not the other, the difference is the rasteriser's, not the site's.
         */
        const isExtreme = (d, x, y) => {
          const at = (xx, yy) => bright(d, (yy * width + xx) * 4);
          const v = at(x, y);
          let min = Infinity;
          let max = -Infinity;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue;
              const xx = x + dx;
              const yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
              const n = at(xx, yy);
              min = Math.min(min, n);
              max = Math.max(max, n);
            }
          return v <= min || v >= max;
        };

        const diff = new Uint8ClampedArray(width * height * 4);
        const cols = Math.ceil(width / cell);
        const rows = Math.ceil(height / cell);
        const grid = new Uint32Array(cols * rows);
        let differing = 0;
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            if (
              A[i] === B[i] &&
              A[i + 1] === B[i + 1] &&
              A[i + 2] === B[i + 2]
            )
              continue;
            const de = ciede2000(
              toLab(A[i], A[i + 1], A[i + 2]),
              toLab(B[i], B[i + 1], B[i + 2]),
            );
            if (de <= deltaE) continue;
            if (isExtreme(A, x, y) !== isExtreme(B, x, y)) continue;
            differing++;
            grid[Math.floor(y / cell) * cols + Math.floor(x / cell)]++;
            diff[i] = 255;
            diff[i + 3] = 255;
          }
        }

        // Cluster the grid cells that hold differences into boxes, so the
        // report can name WHERE rather than only how much.
        const seen = new Uint8Array(grid.length);
        const clusters = [];
        // A cell needs a real population before it counts: a couple of stray
        // pixels is the rasteriser, a region is a defect.
        const floor = Math.max(4, Math.round(cell * cell * 0.002));
        for (let r = 0; r < rows; r++)
          for (let c = 0; c < cols; c++) {
            const idx = r * cols + c;
            if (seen[idx] || grid[idx] < floor) continue;
            const stack = [idx];
            seen[idx] = 1;
            let x0 = c, x1 = c, y0 = r, y1 = r, count = 0;
            while (stack.length) {
              const cur = stack.pop();
              const cr = Math.floor(cur / cols);
              const cc = cur % cols;
              count += grid[cur];
              x0 = Math.min(x0, cc); x1 = Math.max(x1, cc);
              y0 = Math.min(y0, cr); y1 = Math.max(y1, cr);
              for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                const nr = cr + dr;
                const nc = cc + dc;
                if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
                const nidx = nr * cols + nc;
                if (seen[nidx] || grid[nidx] < floor) continue;
                seen[nidx] = 1;
                stack.push(nidx);
              }
            }
            clusters.push({
              x: x0 * cell,
              y: y0 * cell,
              width: (x1 - x0 + 1) * cell,
              height: (y1 - y0 + 1) * cell,
              pixels: count,
            });
          }
        clusters.sort((p, q) => q.pixels - p.pixels);

        // ── per-REGION, part by part ───────────────────────────────────
        // localise() walks a set of regions that DIFFER and reports the
        // deepest one; this is its visual input. A region is compared on its
        // OWN pixels: every instance at its own origin (the third card is
        // compared with the third card, not only the first), and without the
        // pixels any measured region inside it covers, which are that
        // region's to judge. Aligned only at the parent's corner, a list whose
        // rows were each a pixel taller "differed" all the way down
        // (/images/tiles, 1.21% of main content) though every row matched;
        // and a child an exception excuses no longer fails its parent.
        const allBoxes = (side) =>
          regions.flatMap((r) => (r[side]?.boxes ?? (r[side] ? [r[side]] : [])).map((box) => ({ box, name: r.name })));
        const insideBoxes = { a: allBoxes("a"), b: allBoxes("b") };
        // The measured boxes strictly inside `outer` (1px slack for rounding),
        // relative to its origin.
        const childrenOf = (side, outer) =>
          insideBoxes[side]
            .map(({ box }) => box)
            .filter(
              (c) =>
                c.w * c.h < outer.w * outer.h &&
                c.x >= outer.x - 1 &&
                c.y >= outer.y - 1 &&
                c.x + c.w <= outer.x + outer.w + 1 &&
                c.y + c.h <= outer.y + outer.h + 1,
            )
            .map((c) => ({ x: c.x - outer.x, y: c.y - outer.y, w: c.w, h: c.h }));
        const instanceOf = (aR, bR) => {
          const w = Math.min(aR.w, bR.w);
          const h = Math.min(aR.h, bR.h);
          if (w < 1 || h < 1) return null;
          // What the instance's children cover, on either side, in its own
          // coordinates: not this region's to judge.
          const covered = new Uint8Array(w * h);
          for (const c of [...childrenOf("a", aR), ...childrenOf("b", bR)]) {
            const x0 = Math.max(0, c.x);
            const y0 = Math.max(0, c.y);
            const x1 = Math.min(w, c.x + c.w);
            const y1 = Math.min(h, c.y + c.h);
            for (let y = y0; y < y1; y++) covered.fill(1, y * w + x0, y * w + Math.max(x0, x1));
          }
          const P = pixels(a, w, h, aR.x, aR.y);
          const Q = pixels(b, w, h, bR.x, bR.y);
          const br = (d, i) => (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
          const extreme = (d, x, y) => {
            const at = (xx, yy) => br(d, (yy * w + xx) * 4);
            const v = at(x, y);
            let lo = Infinity;
            let hi = -Infinity;
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++) {
                if (!dx && !dy) continue;
                const xx = x + dx;
                const yy = y + dy;
                if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
                const n = at(xx, yy);
                lo = Math.min(lo, n);
                hi = Math.max(hi, n);
              }
            return v <= lo || v >= hi;
          };
          // Not the outermost row and column: a region whose edge falls
          // between pixels (the source's footer starts at y 2476.83 on
          // /images/oversight) draws that row as a blend of it and what is
          // behind it, which the other side draws whole — one row, 0.28% of
          // the footer on four pages, with nothing in it differing.
          let n = 0;
          let own = 0;
          for (let y = 1; y < h - 1; y++)
            for (let x = 1; x < w - 1; x++) {
              if (covered[y * w + x]) continue;
              own++;
              const i = (y * w + x) * 4;
              if (P[i] === Q[i] && P[i + 1] === Q[i + 1] && P[i + 2] === Q[i + 2])
                continue;
              if (
                ciede2000(
                  toLab(P[i], P[i + 1], P[i + 2]),
                  toLab(Q[i], Q[i + 1], Q[i + 2]),
                ) <= deltaE
              )
                continue;
              if (extreme(P, x, y) !== extreme(Q, x, y)) continue;
              n++;
            }
          return { n, own, w, h };
        };
        const regionRatios = {};
        for (const r of regions) {
          if (!r.a || !r.b) continue;
          // Paired in document order; a count that differs is the region's
          // count finding, so only the pairs both sides have are compared.
          const as = r.a.boxes ?? [r.a];
          const bs = r.b.boxes ?? [r.b];
          let n = 0;
          let own = 0;
          let first = null;
          for (let i = 0; i < Math.min(as.length, bs.length); i++) {
            const got = instanceOf(as[i], bs[i]);
            if (!got) continue;
            first ??= got;
            n += got.n;
            own += got.own;
          }
          if (!first) continue;
          // Wholly made of measured children: nothing of its own to differ.
          regionRatios[r.name] = { ratio: own ? n / own : 0, compared: { w: first.w, h: first.h }, own };
        }

        const c = document.createElement("canvas");
        c.width = width;
        c.height = height;
        c.getContext("2d").putImageData(new ImageData(diff, width, height), 0, 0);
        resolve({
          regionRatios,
          ratio: differing / (width * height),
          differing,
          compared: { width, height },
          sizes: { old: [a.width, a.height], new: [b.width, b.height] },
          clusters: clusters.slice(0, 25),
          diff: c.toDataURL("image/png"),
        });
      })
      .catch((error) => reject(new Error(String(error.message ?? error))));
  });
