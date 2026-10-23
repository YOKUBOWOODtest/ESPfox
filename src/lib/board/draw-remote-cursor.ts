import { Camera } from "./camera";

/** Draws a remote user's cursor with their name and color. */
export function drawRemoteCursor(
  context: CanvasRenderingContext2D,
  camera: Camera,
  remote: { userId: string; x: number; y: number; color: string; name: string; lastUpdate: number },
): void {
  const screenX = (remote.x - camera.x) * camera.scale;
  const screenY = (remote.y - camera.y) * camera.scale;

  context.save();

  // Draw cursor circle
  context.beginPath();
  context.arc(screenX, screenY, 10, 0, Math.PI * 2);
  context.fillStyle = remote.color;
  context.fill();
  context.strokeStyle = "#ffffff";
  context.lineWidth = 2;
  context.stroke();

  // Draw name label
  context.fillStyle = remote.color;
  context.font = "600 11px Roboto, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "bottom";
  const padding = 4;
  const metrics = context.measureText(remote.name);
  const textWidth = metrics.width;
  const textHeight = 14;
  const labelX = screenX;
  const labelY = screenY - 14 - 4;

  // Background for text
  context.fillStyle = "rgba(0, 0, 0, 0.7)";
  context.fillRect(
    labelX - metrics.width / 2 - 4,
    labelY - 14 - 4,
    metrics.width + 8,
    14 + 8
  );

  context.fillStyle = "#ffffff";
  context.fillText(remote.name, screenX, screenY - 14 - 4);

  context.restore();
}