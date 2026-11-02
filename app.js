const MAX_FILE_SIZE = 25 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 36_000_000;
const ANALYSIS_WIDTH = 560;
const MAX_ANALYSIS_PIXELS = 700_000;
const SUPPORTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

const elements = {
  input: document.querySelector("#image-input"),
  dropzone: document.querySelector("#dropzone"),
  stage: document.querySelector("#image-stage"),
  image: document.querySelector("#original-image"),
  imageName: document.querySelector("#image-name"),
  imageDimensions: document.querySelector("#image-dimensions"),
  removeImage: document.querySelector("#remove-image"),
  analyze: document.querySelector("#analyze-button"),
  sample: document.querySelector("#sample-button"),
  status: document.querySelector("#status-message"),
  summary: document.querySelector("#analysis-summary"),
  analysisTime: document.querySelector("#analysis-time"),
  description: document.querySelector("#analysis-description"),
  regionCount: document.querySelector("#region-count"),
  layoutCount: document.querySelector("#layout-count"),
  colorCount: document.querySelector("#color-count"),
  regionList: document.querySelector("#region-list"),
  previewTab: document.querySelector("#preview-tab"),
  htmlTab: document.querySelector("#html-tab"),
  cssTab: document.querySelector("#css-tab"),
  previewView: document.querySelector("#preview-view"),
  tabHint: document.querySelector("#tab-hint"),
  previewEmpty: document.querySelector("#preview-empty"),
  preview: document.querySelector("#preview-frame"),
  codeView: document.querySelector("#code-view"),
  codeFilename: document.querySelector("#code-filename"),
  codeEditor: document.querySelector("#code-editor"),
  copyCode: document.querySelector("#copy-code"),
  downloadHtml: document.querySelector("#download-html"),
  downloadProject: document.querySelector("#download-project"),
  resultStatus: document.querySelector("#result-status"),
};

const state = {
  file: null,
  objectUrl: null,
  analysis: null,
  html: "",
  css: "",
  codeMode: "html",
  previewTimer: 0,
  selectedRegion: "",
};

elements.input.addEventListener("change", () => {
  const [file] = elements.input.files ?? [];
  if (file) loadImage(file);
});
elements.removeImage.addEventListener("click", clearImage);
elements.analyze.addEventListener("click", analyzeImage);
elements.sample.addEventListener("click", loadSample);
elements.downloadHtml.addEventListener("click", downloadHtml);
elements.downloadProject.addEventListener("click", downloadProject);
elements.previewTab.addEventListener("click", showPreview);
elements.htmlTab.addEventListener("click", () => showCode("html"));
elements.cssTab.addEventListener("click", () => showCode("css"));
elements.copyCode.addEventListener("click", copyCode);
elements.codeEditor.addEventListener("input", updateSource);
elements.regionList.addEventListener("click", (event) => {
  const item = event.target.closest("[data-frame-id]");
  if (!item) return;
  state.selectedRegion = item.dataset.frameId;
  elements.preview.contentWindow.postMessage({ type: "frame:focus", id: state.selectedRegion }, "*");
});
elements.regionList.addEventListener("keydown", (event) => {
  const item = event.target.closest("[data-frame-id]");
  if (!item || (event.key !== "Enter" && event.key !== " ")) return;
  event.preventDefault();
  item.click();
});
window.addEventListener("message", (event) => {
  if (event.source !== elements.preview.contentWindow || !event.data || typeof event.data !== "object") return;
  if (event.data.type === "frame:select" && /^region-\d+$/.test(event.data.id)) {
    state.selectedRegion = event.data.id;
    for (const item of elements.regionList.querySelectorAll("[data-frame-id]")) {
      item.classList.toggle("is-selected", item.dataset.frameId === state.selectedRegion);
      item.setAttribute("aria-pressed", String(item.dataset.frameId === state.selectedRegion));
    }
    elements.resultStatus.textContent = `Selected ${event.data.label || "element"} · drag Move or a corner`;
    return;
  }
  if (event.data.type !== "frame:geometry" || !/^region-\d+$/.test(event.data.id)) return;
  const { columnStart, columnEnd, rowStart, rowEnd } = event.data;
  if (![columnStart, columnEnd, rowStart, rowEnd].every(Number.isInteger)
    || columnStart < 1 || rowStart < 1 || columnEnd > 101 || rowEnd > 101
    || columnEnd <= columnStart || rowEnd <= rowStart) return;
  const updated = updateElementGrid(state.html, event.data.id, columnStart, columnEnd, rowStart, rowEnd);
  if (updated === state.html) {
    showStatus("This element is no longer in the HTML source. Re-analyze the image to restore visual editing.");
    return;
  }
  state.html = updated;
  state.selectedRegion = event.data.id;
  if (state.codeMode === "html" && !elements.codeView.hidden) elements.codeEditor.value = state.html;
  elements.resultStatus.textContent = `Updated ${event.data.label || "element"} · HTML source is in sync`;
  elements.preview.srcdoc = previewDocument(state.html, state.css);
});

for (const eventName of ["dragenter", "dragover"]) {
  elements.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropzone.classList.add("is-dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  elements.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropzone.classList.remove("is-dragging");
  });
}
elements.dropzone.addEventListener("drop", (event) => {
  const [file] = event.dataTransfer?.files ?? [];
  if (file) loadImage(file);
});

function showStatus(message, kind = "error") {
  elements.status.textContent = message;
  elements.status.hidden = false;
  elements.status.classList.toggle("is-info", kind === "info");
}

function clearStatus() {
  elements.status.hidden = true;
  elements.status.textContent = "";
  elements.status.classList.remove("is-info");
}

function supportedImage(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  return SUPPORTED_TYPES.has(file.type) || ["png", "jpg", "jpeg", "webp"].includes(extension);
}

async function loadImage(file) {
  clearStatus();
  if (!supportedImage(file)) {
    showStatus("That file type is not supported. Choose a PNG, JPG, JPEG, or WebP image.");
    elements.input.value = "";
    return;
  }
  if (file.size > MAX_FILE_SIZE) {
    showStatus("This image is larger than 25 MB. Choose a smaller file and try again.");
    elements.input.value = "";
    return;
  }

  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
    if (image.naturalWidth * image.naturalHeight > MAX_IMAGE_PIXELS) {
      throw new Error("This image has too many pixels for safe browser analysis. Resize it to under 36 megapixels and try again.");
    }
  } catch (error) {
    URL.revokeObjectURL(url);
    showStatus(error instanceof Error && error.message.includes("too many pixels")
      ? error.message
      : "This image could not be decoded. It may be damaged or use an unsupported encoding.");
    elements.input.value = "";
    return;
  }

  releaseCurrentImage();
  state.file = file;
  state.objectUrl = url;
  state.analysis = null;
  elements.image.src = url;
  elements.image.alt = `Uploaded screenshot: ${file.name}`;
  elements.imageName.textContent = file.name;
  elements.imageName.title = file.name;
  elements.imageDimensions.textContent = `${image.naturalWidth} × ${image.naturalHeight} px`;
  elements.stage.hidden = false;
  elements.dropzone.hidden = true;
  elements.analyze.disabled = false;
  elements.analyze.querySelector("span:first-child").textContent = "Analyze layout";
  elements.summary.hidden = true;
  elements.downloadHtml.disabled = true;
  elements.downloadProject.disabled = true;
  clearGeneratedOutput();
  elements.resultStatus.textContent = "Image ready to analyze";
  elements.input.value = "";
}

function releaseCurrentImage() {
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.objectUrl = null;
}

function clearImage() {
  releaseCurrentImage();
  state.file = null;
  state.analysis = null;
  elements.image.removeAttribute("src");
  elements.stage.hidden = true;
  elements.dropzone.hidden = false;
  elements.analyze.disabled = true;
  elements.summary.hidden = true;
  elements.downloadHtml.disabled = true;
  elements.downloadProject.disabled = true;
  clearGeneratedOutput();
  clearStatus();
  elements.resultStatus.textContent = "Waiting for an image";
}

function clearGeneratedOutput() {
  state.html = "";
  state.css = "";
  elements.preview.srcdoc = "";
  elements.previewEmpty.hidden = false;
  elements.codeEditor.value = "";
  showPreview();
}

async function loadSample() {
  const canvas = document.createElement("canvas");
  canvas.width = 920;
  canvas.height = 600;
  const context = canvas.getContext("2d");
  if (!context) {
    showStatus("Your browser could not create the sample image. Upload an image instead.");
    return;
  }
  context.fillStyle = "#f4f5f8";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#ffffff";
  context.fillRect(54, 45, 812, 56);
  context.fillStyle = "#5f58df";
  context.fillRect(77, 62, 24, 22);
  context.fillStyle = "#dfe0e9";
  context.fillRect(122, 67, 115, 10);
  context.fillRect(736, 66, 104, 13);
  context.fillStyle = "#ffffff";
  context.fillRect(54, 124, 520, 262);
  context.fillStyle = "#e9e8ff";
  context.fillRect(78, 149, 75, 12);
  context.fillStyle = "#282d3c";
  context.fillRect(78, 178, 260, 17);
  context.fillRect(78, 204, 210, 17);
  context.fillStyle = "#a0a5b1";
  context.fillRect(78, 241, 400, 7);
  context.fillRect(78, 256, 350, 7);
  context.fillStyle = "#6258e8";
  context.fillRect(78, 287, 115, 37);
  context.fillStyle = "#e8e9ef";
  context.fillRect(593, 124, 273, 262);
  context.fillStyle = "#ffffff";
  context.fillRect(617, 150, 225, 75);
  context.fillStyle = "#dfdff0";
  context.fillRect(635, 168, 70, 9);
  context.fillRect(635, 187, 120, 8);
  context.fillStyle = "#ffffff";
  context.fillRect(617, 242, 225, 118);
  context.fillStyle = "#d3d0ff";
  context.fillRect(638, 263, 49, 49);
  context.fillStyle = "#626a78";
  context.fillRect(705, 270, 100, 8);
  context.fillRect(705, 288, 79, 7);
  context.fillStyle = "#ffffff";
  context.fillRect(54, 410, 812, 145);
  context.fillStyle = "#dedfe8";
  context.fillRect(78, 435, 115, 10);
  context.fillStyle = "#ececff";
  context.fillRect(78, 462, 230, 69);
  context.fillStyle = "#e5f4ef";
  context.fillRect(327, 462, 230, 69);
  context.fillStyle = "#fff2e4";
  context.fillRect(576, 462, 266, 69);
  canvas.toBlob((blob) => {
    if (blob) loadImage(new File([blob], "sample-dashboard.png", { type: "image/png" }));
    else showStatus("The sample image could not be prepared. Upload an image instead.");
  }, "image/png");
}

async function analyzeImage() {
  if (!state.file || !state.objectUrl) return;
  clearStatus();
  elements.analyze.disabled = true;
  elements.analyze.querySelector("span:first-child").textContent = "Analyzing…";
  elements.resultStatus.textContent = "Analyzing image geometry…";
  const started = performance.now();

  try {
    const image = new Image();
    image.src = state.objectUrl;
    await image.decode();
    const scale = Math.min(
      1,
      ANALYSIS_WIDTH / image.naturalWidth,
      Math.sqrt(MAX_ANALYSIS_PIXELS / (image.naturalWidth * image.naturalHeight)),
    );
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Your browser could not start image analysis. Try another browser.");
    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    const analysis = detectRegions(pixels, image.naturalWidth, image.naturalHeight);
    state.analysis = analysis;
    const generated = generateLayout(analysis, image.naturalWidth, image.naturalHeight, state.file.name);
    state.html = generated.html;
    state.css = generated.css;
    renderAnalysis(analysis, performance.now() - started);
    elements.previewEmpty.hidden = true;
    elements.preview.srcdoc = previewDocument(state.html, state.css);
    elements.downloadHtml.disabled = false;
    elements.downloadProject.disabled = false;
    elements.resultStatus.textContent = `Layout ready · ${analysis.regions.length} detected regions`;
    elements.resultStatus.parentElement.querySelector(".footer-live-dot").classList.add("is-ready");
    showPreview();
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "The image could not be analyzed. Try another image.");
    elements.resultStatus.textContent = "Analysis could not be completed";
  } finally {
    elements.analyze.disabled = false;
    elements.analyze.querySelector("span:first-child").textContent = "Analyze layout";
  }
}

function detectRegions(imageData, originalWidth, originalHeight) {
  const { data, width, height } = imageData;
  const pixelCount = width * height;
  const background = estimateBackground(data, width, height);
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const candidates = [];
  const minArea = Math.max(8, pixelCount * 0.000025);
  const bgThreshold = 16;
  const componentThreshold = 18;

  for (let index = 0; index < pixelCount; index += 1) {
    if (visited[index]) continue;
    const offset = index * 4;
    if (colorDistance(data[offset], data[offset + 1], data[offset + 2], background) < bgThreshold) {
      visited[index] = 1;
      continue;
    }

    const seed = [data[offset], data[offset + 1], data[offset + 2]];
    let head = 0;
    let tail = 0;
    queue[tail++] = index;
    visited[index] = 1;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;

    while (head < tail) {
      const current = queue[head++];
      const x = current % width;
      const y = Math.floor(current / width);
      const currentOffset = current * 4;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      sumR += data[currentOffset];
      sumG += data[currentOffset + 1];
      sumB += data[currentOffset + 2];

      for (let dy = -1; dy <= 1; dy += 1) {
        const nextY = y + dy;
        if (nextY < 0 || nextY >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nextX = x + dx;
          if (nextX < 0 || nextX >= width) continue;
          const next = nextY * width + nextX;
          if (visited[next]) continue;
          const nextOffset = next * 4;
          if (colorDistance(data[nextOffset], data[nextOffset + 1], data[nextOffset + 2], background) < bgThreshold) {
            visited[next] = 1;
            continue;
          }
          if (colorDistance(data[nextOffset], data[nextOffset + 1], data[nextOffset + 2], seed) > componentThreshold) continue;
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }

    const boxWidth = maxX - minX + 1;
    const boxHeight = maxY - minY + 1;
    const touchesEdge = minX <= 1 || minY <= 1 || maxX >= width - 2 || maxY >= height - 2;
    if (tail < minArea || boxWidth < 4 || boxHeight < 3 || (touchesEdge && tail > pixelCount * 0.025)) continue;
    candidates.push({
      x: minX,
      y: minY,
      width: boxWidth,
      height: boxHeight,
      area: tail,
      color: rgbHex(Math.round(sumR / tail), Math.round(sumG / tail), Math.round(sumB / tail)),
      density: tail / (boxWidth * boxHeight),
    });
  }

  candidates.sort((a, b) => b.area - a.area);
  const limited = candidates.slice(0, 360);
  const merged = mergeTextRegions(limited, width);
  const detected = merged
    .filter((region) => region.width >= 5 && region.height >= 4)
    .map((region, index) => {
      const category = classifyRegion(region, width, height);
      return {
        id: index + 1,
        ...region,
        category,
        xPercent: region.x / width * 100,
        yPercent: region.y / height * 100,
        widthPercent: region.width / width * 100,
        heightPercent: region.height / height * 100,
      };
    });
  const regions = mergeBackdropFillRegions(
    mergeOverlappingColorRegions(removeDuplicateRegions(detected), width, height),
    background,
    width,
    height,
  )
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .slice(0, 72)
    .map((region, index) => ({
      ...region,
      id: index + 1,
      xPercent: region.x / width * 100,
      yPercent: region.y / height * 100,
      widthPercent: region.width / width * 100,
      heightPercent: region.height / height * 100,
    }));

  const colors = new Set(regions.map((region) => region.color));
  const rows = groupRows(regions);
  return { regions, rows, colors, background: rgbHex(...background), width, height, originalWidth, originalHeight };
}

function removeDuplicateRegions(regions) {
  const byArea = [...regions].sort((a, b) => b.area - a.area);
  const kept = [];
  for (const candidate of byArea) {
    const duplicate = kept.some((existing) => {
      const smallerArea = Math.min(candidate.width * candidate.height, existing.width * existing.height);
      const largerArea = Math.max(candidate.width * candidate.height, existing.width * existing.height);
      if (smallerArea / largerArea < 0.72) return false;
      const overlapWidth = Math.max(0, Math.min(candidate.x + candidate.width, existing.x + existing.width) - Math.max(candidate.x, existing.x));
      const overlapHeight = Math.max(0, Math.min(candidate.y + candidate.height, existing.y + existing.height) - Math.max(candidate.y, existing.y));
      return overlapWidth * overlapHeight / smallerArea > 0.9;
    });
    if (!duplicate) kept.push(candidate);
  }
  return kept;
}

function mergeOverlappingColorRegions(regions, imageWidth, imageHeight) {
  const items = [...regions];
  const minimumArea = imageWidth * imageHeight * 0.015;
  let changed = true;

  while (changed) {
    changed = false;
    outer: for (let first = 0; first < items.length; first += 1) {
      const a = items[first];
      if (a.category === "text" || a.category === "input" || a.category === "band"
        || a.width * a.height < minimumArea) continue;

      for (let second = first + 1; second < items.length; second += 1) {
        const b = items[second];
        if (b.category === "text" || b.category === "input" || b.category === "band"
          || b.width * b.height < minimumArea
          || colorDistance(...hexRgb(a.color), hexRgb(b.color)) > 42) continue;

        const overlapWidth = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
        const overlapHeight = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
        const smallerArea = Math.min(a.width * a.height, b.width * b.height);
        if (overlapWidth * overlapHeight / smallerArea < 0.45) continue;

        const left = Math.min(a.x, b.x);
        const top = Math.min(a.y, b.y);
        const right = Math.max(a.x + a.width, b.x + b.width);
        const bottom = Math.max(a.y + a.height, b.y + b.height);
        const combinedArea = a.area + b.area;
        const colorA = hexRgb(a.color);
        const colorB = hexRgb(b.color);
        a.color = rgbHex(...colorA.map((channel, index) => Math.round((channel * a.area + colorB[index] * b.area) / combinedArea)));
        a.x = left;
        a.y = top;
        a.width = right - left;
        a.height = bottom - top;
        a.area = combinedArea;
        a.density = combinedArea / (a.width * a.height);
        if (a.category !== "surface" && b.category === "surface") a.category = "surface";
        items.splice(second, 1);
        changed = true;
        break outer;
      }
    }
  }

  return items;
}

function mergeBackdropFillRegions(regions, background, imageWidth, imageHeight) {
  const suppressed = new Set();
  const shells = [...regions].sort((a, b) => b.width * b.height - a.width * a.height);

  for (const shell of shells) {
    const shellArea = shell.width * shell.height;
    if (shellArea < imageWidth * imageHeight * 0.02
      || colorDistance(...hexRgb(shell.color), background) > 70) continue;

    const fill = regions
      .filter((candidate) => {
        if (candidate === shell || suppressed.has(candidate)) return false;
        const areaRatio = candidate.width * candidate.height / shellArea;
        const horizontalCoverage = candidate.width / shell.width;
        const contained = candidate.x >= shell.x - 2
          && candidate.x + candidate.width <= shell.x + shell.width + 2
          && candidate.y >= shell.y - 2
          && candidate.y + candidate.height >= shell.y + shell.height * 0.78;
        return areaRatio >= 0.5 && areaRatio <= 0.9
          && horizontalCoverage >= 0.78
          && candidate.y <= shell.y + shell.height * 0.38
          && contained
          && colorDistance(...hexRgb(candidate.color), hexRgb(shell.color)) > 65;
      })
      .sort((a, b) => b.width * b.height - a.width * a.height)[0];

    if (!fill) continue;
    shell.color = fill.color;
    if (shell.category === "accent" || shell.category === "media") shell.category = "surface";
    suppressed.add(fill);
  }

  return regions.filter((region) => !suppressed.has(region));
}

function estimateBackground(data, width, height) {
  const points = [
    [1, 1], [width - 2, 1], [1, height - 2], [width - 2, height - 2],
    [Math.floor(width / 2), 1], [Math.floor(width / 2), height - 2],
    [1, Math.floor(height / 2)], [width - 2, Math.floor(height / 2)],
  ];
  const samples = points.map(([x, y]) => {
    const offset = (Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))) * 4;
    return [data[offset], data[offset + 1], data[offset + 2]];
  });
  return [0, 1, 2].map((channel) => {
    const sorted = samples.map((sample) => sample[channel]).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  });
}

function colorDistance(r, g, b, color) {
  const dr = r - color[0];
  const dg = g - color[1];
  const db = b - color[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function rgbHex(red, green, blue) {
  return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function mergeTextRegions(regions, imageWidth) {
  const items = regions.map((region) => ({ ...region }));
  const maxGap = Math.max(8, imageWidth * 0.035);
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let first = 0; first < items.length; first += 1) {
      const a = items[first];
      if (!isTextLike(a)) continue;
      for (let second = first + 1; second < items.length; second += 1) {
        const b = items[second];
        if (!isTextLike(b)) continue;
        const overlap = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
        const overlapRatio = overlap / Math.max(1, Math.min(a.height, b.height));
        const horizontalGap = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width));
        const centerDifference = Math.abs((a.y + a.height / 2) - (b.y + b.height / 2));
        const sameTextLine = (overlapRatio > 0.25 || centerDifference <= 2.5) && horizontalGap <= maxGap;
        const similarColumns = Math.abs(a.x - b.x) <= maxGap
          && b.y >= a.y + a.height - Math.min(a.height, b.height) * 0.15
          && b.y - (a.y + a.height) <= Math.max(3, a.height * 0.3);
        if (!sameTextLine && !similarColumns) continue;

        const left = Math.min(a.x, b.x);
        const top = Math.min(a.y, b.y);
        const right = Math.max(a.x + a.width, b.x + b.width);
        const bottom = Math.max(a.y + a.height, b.y + b.height);
        const area = a.area + b.area;
        const colorA = hexRgb(a.color);
        const colorB = hexRgb(b.color);
        a.color = rgbHex(...colorA.map((channel, index) => Math.round((channel * a.area + colorB[index] * b.area) / area)));
        a.x = left;
        a.y = top;
        a.width = right - left;
        a.height = bottom - top;
        a.area = area;
        a.density = area / (a.width * a.height);
        items.splice(second, 1);
        changed = true;
        break outer;
      }
    }
    if (!changed) break;
  }
  return items;
}

function isTextLike(region) {
  return region.width * region.height < 15000 && region.height < 56 && region.width < 450;
}

function hexRgb(hex) {
  return [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
}

function classifyRegion(region, imageWidth, imageHeight) {
  const aspect = region.width / Math.max(1, region.height);
  const relativeArea = region.width * region.height / (imageWidth * imageHeight);
  if (region.height < imageHeight * 0.035 && region.width > imageWidth * 0.58) return "band";
  if (aspect > 7 && region.width > imageWidth * 0.5
    && region.height >= imageHeight * 0.035 && region.height < imageHeight * 0.06) return "input";
  if (isTextLike(region) && (region.density < 0.58 || (aspect > 2.3 && region.height < imageHeight * 0.045))) return "text";
  if (relativeArea > 0.018 && region.density > 0.18) return aspect > 1.45 ? "surface" : "media";
  if (aspect > 3.2 && region.height < imageHeight * 0.09) return "accent";
  return aspect < 0.82 ? "media" : "accent";
}

function groupRows(regions) {
  const rows = [];
  for (const region of [...regions].sort((a, b) => a.y - b.y || a.x - b.x)) {
    let row = rows.find((candidate) => {
      const intersection = Math.max(0, Math.min(candidate.bottom, region.y + region.height) - Math.max(candidate.top, region.y));
      const overlapRatio = intersection / Math.max(1, Math.min(candidate.bottom - candidate.top, region.height));
      const centerDifference = Math.abs((candidate.top + candidate.bottom) / 2 - (region.y + region.height / 2));
      return overlapRatio >= 0.28 || centerDifference <= 5;
    });
    if (!row) {
      row = { top: region.y, bottom: region.y + region.height, regions: [] };
      rows.push(row);
    }
    row.top = Math.min(row.top, region.y);
    row.bottom = Math.max(row.bottom, region.y + region.height);
    row.regions.push(region);
  }
  return rows.sort((a, b) => a.top - b.top);
}

function renderAnalysis(analysis, elapsed) {
  const count = analysis.regions.length;
  elements.summary.hidden = false;
  elements.analysisTime.textContent = `${Math.max(1, Math.round(elapsed))} ms`;
  elements.regionCount.textContent = String(count);
  elements.layoutCount.textContent = String(analysis.rows.length);
  elements.colorCount.textContent = String(analysis.colors.size);
  elements.description.textContent = count
    ? `Found ${count} distinct visual regions across ${analysis.rows.length} aligned bands. Position, containment, and color are inferred locally; text is shown as visual bars rather than transcribed.`
    : "No clear foreground regions were found. A simple editable starter layout was created; try a higher-contrast screenshot for more detail.";
  elements.regionList.replaceChildren();
  if (!count) {
    const empty = document.createElement("li");
    empty.className = "region-empty";
    empty.textContent = "No distinct regions detected";
    elements.regionList.append(empty);
  } else {
    for (const region of analysis.regions.slice(0, 24)) {
      const item = document.createElement("li");
      item.dataset.frameId = `region-${region.id}`;
      item.tabIndex = 0;
      item.setAttribute("role", "button");
      item.setAttribute("aria-pressed", "false");
      const swatch = document.createElement("span");
      swatch.className = "region-swatch";
      swatch.style.backgroundColor = region.color;
      const name = document.createElement("span");
      name.className = "region-name";
      name.textContent = `${region.category} ${region.id}`;
      const size = document.createElement("span");
      size.className = "region-size";
      size.textContent = `${Math.round(region.xPercent)}%, ${Math.round(region.yPercent)}% · ${Math.round(region.widthPercent)} × ${Math.round(region.heightPercent)}%`;
      item.append(swatch, name, size);
      elements.regionList.append(item);
    }
    if (count > 24) {
      const more = document.createElement("li");
      more.className = "region-empty";
      more.textContent = `and ${count - 24} more regions`;
      elements.regionList.append(more);
    }
  }
}

function generateLayout(analysis, originalWidth, originalHeight, fileName) {
  const title = escapeHtml(fileName.replace(/\.[^.]+$/, "") || "Reconstructed layout");
  const nodes = analysis.regions.map((region) => ({ region, children: [] }));
  const area = (region) => region.width * region.height;
  for (const child of nodes) {
    const region = child.region;
    const parents = nodes.filter((candidate) => {
      if (candidate === child || candidate.region.category === "input"
        || area(candidate.region) < area(region) * 1.45) return false;
      const parent = candidate.region;
      const insetX = Math.min(parent.width * 0.08, 3);
      const insetY = Math.min(parent.height * 0.08, 3);
      return region.x >= parent.x + insetX
        && region.y >= parent.y + insetY
        && region.x + region.width <= parent.x + parent.width - insetX
        && region.y + region.height <= parent.y + parent.height - insetY;
    }).sort((a, b) => area(a.region) - area(b.region));
    if (parents.length) child.parent = parents[0];
  }
  for (const node of nodes) {
    if (node.parent) node.parent.children.push(node);
  }
  const roots = nodes.filter((node) => !node.parent).sort((a, b) => area(b.region) - area(a.region));
  const gridPlacement = (region, parent = null) => {
    const baseX = parent?.x ?? 0;
    const baseY = parent?.y ?? 0;
    const baseWidth = parent?.width ?? analysis.width;
    const baseHeight = parent?.height ?? analysis.height;
    const columnStart = Math.max(1, Math.min(100, Math.floor((region.x - baseX) / baseWidth * 100) + 1));
    const columnEnd = Math.max(columnStart + 1, Math.min(101, Math.ceil((region.x + region.width - baseX) / baseWidth * 100) + 1));
    const rowStart = Math.max(1, Math.min(100, Math.floor((region.y - baseY) / baseHeight * 100) + 1));
    const rowEnd = Math.max(rowStart + 1, Math.min(101, Math.ceil((region.y + region.height - baseY) / baseHeight * 100) + 1));
    return `grid-column:${columnStart}/${columnEnd};grid-row:${rowStart}/${rowEnd};--element-color:${region.color}`;
  };
  const renderNode = (node) => {
    const { region } = node;
    const isText = region.category === "text";
    const isInput = region.category === "input";
    const tag = isInput ? "input" : isText ? "p" : region.category === "surface" ? "article" : region.category === "media" ? "figure" : "div";
    const label = `${region.category} ${region.id}`;
    const children = [...node.children].sort((a, b) => area(b.region) - area(a.region));
    const content = children.length
      ? children.map((child) => renderNode(child)).join("\n")
      : isText ? '<span class="text-placeholder" aria-hidden="true"></span>' : "";
    const containerClass = children.length ? " element--container" : "";
    const inputAttributes = isInput ? ' type="text" autocomplete="off"' : "";
    if (isInput) {
      return `      <input class="element element--input" data-frame-id="region-${region.id}" aria-label="Detected text input ${region.id}"${inputAttributes} style="${gridPlacement(region, node.parent?.region ?? null)}">`;
    }
    return `      <${tag} class="element element--${region.category}${containerClass}" data-frame-id="region-${region.id}" aria-label="${label}" style="${gridPlacement(region, node.parent?.region ?? null)}">\n${content ? `${content}\n      ` : ""}</${tag}>`;
  };
  const content = roots.length
    ? roots.map((node) => renderNode(node)).join("\n")
    : `      <article class="element element--surface starter-card" aria-label="Editable content area">Editable content area</article>`;

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title} — Divine layout</title>
    <link rel="stylesheet" href="./styles.css">
  </head>
  <body>
    <main class="layout" aria-label="Reconstructed layout" style="--image-height-ratio:${(originalHeight / originalWidth).toFixed(5)}">
${content}
    </main>
  </body>
</html>
`;
  const css = `* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-width: 320px;
  background: ${analysis.background};
  color: #252a35;
  font-family: Arial, Helvetica, sans-serif;
}

.layout {
  width: min(100%, 1120px);
  height: calc(min(100vw, 1120px) * var(--image-height-ratio));
  margin-inline: auto;
  display: grid;
  grid-template-columns: repeat(100, minmax(0, 1fr));
  grid-template-rows: repeat(100, minmax(0, 1fr));
}

.element {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  border-radius: clamp(2px, .7vw, 8px);
  background: var(--element-color, #e8eaf0);
}

.element--container { display: grid; place-items: stretch; grid-template-columns: repeat(100, minmax(0, 1fr)); grid-template-rows: repeat(100, minmax(0, 1fr)); }
.element--text {
  display: flex;
  align-items: center;
  background: transparent;
  padding-inline: .15%;
}

.text-placeholder {
  width: 82%;
  height: max(2px, 38%);
  max-height: 8px;
  border-radius: 999px;
  background: var(--element-color, #747b88);
  opacity: .8;
}

.element--media {
  display: grid;
  place-items: center;
  color: #626978;
  font-size: clamp(9px, 1vw, 13px);
}
.element--media.element--container { place-items: stretch; }

.element--surface { border: 1px solid #e2e4e9; border-color: color-mix(in srgb, var(--element-color) 85%, #9da3b0); }
.element--band { border-radius: 0; }
.element--input { padding: 0 1.2%; border: 1px solid #dedbe7; color: #555164; font: clamp(9px, 1vw, 12px) Arial, sans-serif; }
.element--accent { background: var(--element-color); }
.starter-card { display: grid; place-items: center; color: #727888; font-size: 14px; }
`;
  return { html, css };
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function previewDocument(html, css) {
  const safeCss = css.replace(/<\/style/gi, "<\\/style");
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  const nonce = [...nonceBytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">`;
  const editor = `
<style>
#frame-editor-overlay { position:fixed; z-index:2147483647; box-sizing:border-box; border:1px solid #6954c8; pointer-events:none; }
#frame-editor-overlay[hidden] { display:none; }
#frame-editor-overlay .frame-move { position:absolute; left:50%; top:-29px; transform:translateX(-50%); height:24px; padding:0 9px; border:0; border-radius:5px; background:#5a46b5; color:#fff; font:11px/24px system-ui,sans-serif; white-space:nowrap; cursor:move; pointer-events:auto; box-shadow:0 2px 8px #30204a33; }
#frame-editor-overlay .frame-handle { position:absolute; width:12px; height:12px; border:2px solid #6954c8; border-radius:3px; background:#fff; touch-action:none; pointer-events:auto; }
#frame-editor-overlay [data-action="nw"] { left:-6px; top:-6px; cursor:nwse-resize; }
#frame-editor-overlay [data-action="ne"] { right:-6px; top:-6px; cursor:nesw-resize; }
#frame-editor-overlay [data-action="sw"] { left:-6px; bottom:-6px; cursor:nesw-resize; }
#frame-editor-overlay [data-action="se"] { right:-6px; bottom:-6px; cursor:nwse-resize; }
.frame-edit-selected { outline:2px solid #6954c8 !important; outline-offset:1px; }
</style>
<div id="frame-editor-overlay" hidden aria-hidden="true">
  <button class="frame-move" type="button" data-action="move" title="Drag to move this element">Move</button>
  <span class="frame-handle" data-action="nw"></span><span class="frame-handle" data-action="ne"></span>
  <span class="frame-handle" data-action="sw"></span><span class="frame-handle" data-action="se"></span>
</div>
<script nonce="${nonce}">${previewEditorScript()}</script>`;
  let document = html.replace('<link rel="stylesheet" href="./styles.css">', `<style>${safeCss}</style>`);
  document = document.replace("<head>", `<head>${policy}`);
  return document.includes("</body>") ? document.replace("</body>", `${editor}</body>`) : `${document}${editor}`;
}

function previewEditorScript() {
  return `(() => {
  const overlay = document.querySelector("#frame-editor-overlay");
  let selected = null;
  let drag = null;
  let resizeObserver = null;

  function updateOverlay() {
    if (!selected || !selected.isConnected) { overlay.hidden = true; return; }
    const rect = selected.getBoundingClientRect();
    overlay.style.left = rect.left + "px";
    overlay.style.top = rect.top + "px";
    overlay.style.width = rect.width + "px";
    overlay.style.height = rect.height + "px";
    overlay.hidden = false;
  }

  function select(element, notify = true) {
    if (!element || element === overlay || !element.dataset.frameId) return;
    if (selected) selected.classList.remove("frame-edit-selected");
    if (resizeObserver) resizeObserver.disconnect();
    selected = element;
    selected.classList.add("frame-edit-selected");
    if ("ResizeObserver" in window) {
      resizeObserver = new ResizeObserver(updateOverlay);
      resizeObserver.observe(selected);
    }
    updateOverlay();
    if (notify) parent.postMessage({ type: "frame:select", id: selected.dataset.frameId, label: selected.getAttribute("aria-label") || "element" }, "*");
  }

  function line(value, extent) {
    return Math.max(1, Math.min(101, Math.round(value / Math.max(1, extent) * 100) + 1));
  }

  document.addEventListener("click", event => {
    if (event.target.closest("#frame-editor-overlay")) return;
    const element = event.target.closest("[data-frame-id]");
    if (!element) return;
    event.preventDefault();
    select(element);
  }, true);

  overlay.addEventListener("pointerdown", event => {
    const action = event.target.dataset.action;
    if (!action || !selected) return;
    event.preventDefault();
    event.stopPropagation();
    const parent = selected.parentElement;
    const rect = selected.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    drag = {
      action, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
      parent, parentLeft: parentRect.left + parent.clientLeft, parentTop: parentRect.top + parent.clientTop,
      parentWidth: parent.clientWidth, parentHeight: parent.clientHeight,
      minX: parentRect.left, minY: parentRect.top, maxX: parentRect.right, maxY: parentRect.bottom,
    };
    event.target.setPointerCapture(event.pointerId);
  });

  overlay.addEventListener("pointermove", event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    let left = drag.left, right = drag.right, top = drag.top, bottom = drag.bottom;
    if (drag.action === "move") {
      const width = right - left, height = bottom - top;
      left = Math.max(drag.minX, Math.min(drag.maxX - width, left + dx));
      top = Math.max(drag.minY, Math.min(drag.maxY - height, top + dy));
      right = left + width; bottom = top + height;
    } else {
      if (drag.action.includes("w")) left = Math.max(drag.minX, Math.min(right - 20, left + dx));
      if (drag.action.includes("e")) right = Math.min(drag.maxX, Math.max(left + 20, right + dx));
      if (drag.action.includes("n")) top = Math.max(drag.minY, Math.min(bottom - 20, top + dy));
      if (drag.action.includes("s")) bottom = Math.min(drag.maxY, Math.max(top + 20, bottom + dy));
    }
    overlay.style.left = left + "px";
    overlay.style.top = top + "px";
    overlay.style.width = (right - left) + "px";
    overlay.style.height = (bottom - top) + "px";
  });

  function finishDrag(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const current = drag;
    drag = null;
    const rect = overlay.getBoundingClientRect();
    const columnStart = line(rect.left - current.parentLeft, current.parentWidth);
    const columnEnd = Math.max(columnStart + 1, line(rect.right - current.parentLeft, current.parentWidth));
    const rowStart = line(rect.top - current.parentTop, current.parentHeight);
    const rowEnd = Math.max(rowStart + 1, line(rect.bottom - current.parentTop, current.parentHeight));
    selected.style.gridColumn = columnStart + "/" + columnEnd;
    selected.style.gridRow = rowStart + "/" + rowEnd;
    updateOverlay();
    parent.postMessage({
      type: "frame:geometry", id: selected.dataset.frameId,
      label: selected.getAttribute("aria-label") || "element",
      columnStart, columnEnd, rowStart, rowEnd,
    }, "*");
  }
  overlay.addEventListener("pointerup", finishDrag);
  overlay.addEventListener("pointercancel", finishDrag);
  window.addEventListener("resize", updateOverlay);
  window.addEventListener("scroll", updateOverlay, true);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && selected) {
      selected.classList.remove("frame-edit-selected");
      selected = null;
      overlay.hidden = true;
    }
  });
  addEventListener("message", event => {
    if (event.source !== parent || !event.data || event.data.type !== "frame:focus" || !/^region-\\d+$/.test(event.data.id)) return;
    select(document.querySelector('[data-frame-id="' + event.data.id + '"]'));
  });
  const initial = "${state.selectedRegion}";
  if (initial) select(document.querySelector('[data-frame-id="' + initial + '"]'), false);
})();`;
}

function updateElementGrid(html, id, columnStart, columnEnd, rowStart, rowEnd) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const openingTag = new RegExp(`(<[a-z][^>]*\\bdata-frame-id="${escapedId}"[^>]*\\bstyle=")([^"]*)(")`, "i");
  return html.replace(openingTag, (_match, prefix, style, suffix) => {
    const updatedStyle = style
      .replace(/\bgrid-column\s*:[^;]+;?/i, "")
      .replace(/\bgrid-row\s*:[^;]+;?/i, "")
      .replace(/;;+/g, ";")
      .replace(/^;|;$/g, "");
    return `${prefix}${updatedStyle};grid-column:${columnStart}/${columnEnd};grid-row:${rowStart}/${rowEnd}${suffix}`;
  });
}

function showPreview() {
  setTab(elements.previewTab);
  elements.previewView.hidden = false;
  elements.codeView.hidden = true;
  elements.tabHint.textContent = state.html ? "Click to select · drag Move or a corner to edit" : "Upload an image to generate a layout";
}

function showCode(mode) {
  state.codeMode = mode;
  setTab(mode === "html" ? elements.htmlTab : elements.cssTab);
  elements.previewView.hidden = true;
  elements.codeView.hidden = false;
  elements.codeView.setAttribute("aria-labelledby", mode === "html" ? "html-tab" : "css-tab");
  elements.codeFilename.textContent = mode === "html" ? "index.html" : "styles.css";
  elements.codeEditor.setAttribute("aria-label", `Editable generated ${mode.toUpperCase()}`);
  elements.codeEditor.value = mode === "html" ? state.html : state.css;
  elements.tabHint.textContent = "Edit source to update preview";
  if (state.html) elements.codeEditor.focus();
}

function setTab(active) {
  for (const tab of [elements.previewTab, elements.htmlTab, elements.cssTab]) {
    const selected = tab === active;
    tab.classList.toggle("is-active", selected);
    tab.setAttribute("aria-selected", String(selected));
  }
}

function updateSource() {
  if (state.codeMode === "html") state.html = elements.codeEditor.value;
  else state.css = elements.codeEditor.value;
  window.clearTimeout(state.previewTimer);
  state.previewTimer = window.setTimeout(() => {
    elements.preview.srcdoc = previewDocument(state.html, state.css);
    elements.previewEmpty.hidden = !state.html;
    elements.resultStatus.textContent = "Preview updated from edited source";
  }, 180);
}

async function copyCode() {
  try {
    await navigator.clipboard.writeText(elements.codeEditor.value);
    elements.copyCode.textContent = "Copied";
    window.setTimeout(() => { elements.copyCode.textContent = "Copy code"; }, 1400);
  } catch {
    elements.codeEditor.select();
    showStatus("Clipboard access is unavailable here. Select and copy the code from the editor.");
  }
}

function downloadHtml() {
  if (!state.html) return;
  const blob = new Blob([state.html], { type: "text/html;charset=utf-8" });
  downloadBlob(blob, "index.html");
}

async function downloadProject() {
  if (!state.html || !state.css) return;
  elements.downloadProject.disabled = true;
  const originalLabel = elements.downloadProject.querySelector("span:first-child").textContent;
  elements.downloadProject.querySelector("span:first-child").textContent = "Preparing…";
  try {
    const readme = `# Generated layout

This project was generated locally in your browser from image geometry.

## Files
- index.html: editable semantic layout structure
- styles.css: responsive CSS Grid styling

Open index.html in a browser. No build step or server is required.
`;
    const archive = makeZip([
      { name: "index.html", data: state.html },
      { name: "styles.css", data: state.css },
      { name: "README.md", data: readme },
    ]);
    downloadBlob(new Blob([archive], { type: "application/zip" }), "divine-layout.zip");
    elements.resultStatus.textContent = "Project downloaded";
  } catch (error) {
    showStatus(error instanceof Error ? `Project download failed: ${error.message}` : "Project download failed. Try downloading the HTML instead.");
  } finally {
    elements.downloadProject.disabled = false;
    elements.downloadProject.querySelector("span:first-child").textContent = originalLabel;
  }
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function makeZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  const crcTable = createCrcTable();
  const write16 = (view, offset, value) => view.setUint16(offset, value, true);
  const write32 = (view, offset, value) => view.setUint32(offset, value >>> 0, true);

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.data);
    const crc = crc32(data, crcTable);
    const local = new Uint8Array(30 + name.length + data.length);
    const localView = new DataView(local.buffer);
    write32(localView, 0, 0x04034b50);
    write16(localView, 4, 20);
    write16(localView, 6, 0x0800);
    write16(localView, 8, 0);
    write16(localView, 10, 0);
    write16(localView, 12, 0x0021);
    write32(localView, 14, crc);
    write32(localView, 18, data.length);
    write32(localView, 22, data.length);
    write16(localView, 26, name.length);
    write16(localView, 28, 0);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    localParts.push(local);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    write32(centralView, 0, 0x02014b50);
    write16(centralView, 4, 20);
    write16(centralView, 6, 20);
    write16(centralView, 8, 0x0800);
    write16(centralView, 10, 0);
    write16(centralView, 12, 0);
    write16(centralView, 14, 0x0021);
    write32(centralView, 16, crc);
    write32(centralView, 20, data.length);
    write32(centralView, 24, data.length);
    write16(centralView, 28, name.length);
    write16(centralView, 30, 0);
    write16(centralView, 32, 0);
    write16(centralView, 34, 0);
    write16(centralView, 36, 0);
    write32(centralView, 38, 0);
    write32(centralView, 42, localOffset);
    central.set(name, 46);
    centralParts.push(central);
    localOffset += local.length;
  }

  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  write32(endView, 0, 0x06054b50);
  write16(endView, 4, 0);
  write16(endView, 6, 0);
  write16(endView, 8, files.length);
  write16(endView, 10, files.length);
  write32(endView, 12, centralSize);
  write32(endView, 16, localOffset);
  write16(endView, 20, 0);
  return concatBytes([...localParts, ...centralParts, end]);
}

function createCrcTable() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
}

function crc32(data, table) {
  let crc = 0xffffffff;
  for (const byte of data) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function concatBytes(parts) {
  const total = parts.reduce((length, part) => length + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
