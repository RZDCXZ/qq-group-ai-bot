import { describe, expect, it, vi } from "vitest";

import { UserFacingError } from "../src/errors.js";
import { OneBotImageLoader } from "../src/onebot/image-loader.js";
import type { OneBotActionCaller } from "../src/onebot/types.js";

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00,
  0x0d,
]);

function createCaller() {
  return {
    call: vi.fn<OneBotActionCaller["call"]>(),
  };
}

describe("OneBotImageLoader", () => {
  it("下载 QQ 图片并转换为中转站可接收的 data URL", async () => {
    const caller = createCaller();
    const fetchMock = vi.fn(async () =>
      new Response(PNG_BYTES, {
        headers: {
          "content-type": "image/png",
          "content-length": String(PNG_BYTES.byteLength),
        },
      }),
    );
    const loader = new OneBotImageLoader(caller, {
      fetch: fetchMock as typeof fetch,
    });

    await expect(
      loader.load([
        {
          file: "qq-image.png",
          url: "https://multimedia.nt.qq.com.cn/download?id=example",
          fileSize: PNG_BYTES.byteLength,
        },
      ]),
    ).resolves.toEqual([
      {
        dataUrl: `data:image/png;base64,${Buffer.from(PNG_BYTES).toString("base64")}`,
        detail: "auto",
      },
    ]);
    expect(caller.call).not.toHaveBeenCalled();
  });

  it("在消息段没有直链时通过 get_image 读取 NapCat 缓存", async () => {
    const caller = createCaller();
    caller.call.mockResolvedValue({
      base64: Buffer.from(PNG_BYTES).toString("base64"),
    });
    const loader = new OneBotImageLoader(caller);

    await expect(loader.load([{ file: "cached-image.png" }])).resolves.toEqual([
      {
        dataUrl: `data:image/png;base64,${Buffer.from(PNG_BYTES).toString("base64")}`,
        detail: "auto",
      },
    ]);
    expect(caller.call).toHaveBeenCalledWith("get_image", {
      file: "cached-image.png",
    });
  });

  it("拒绝本机地址、超大图片、过多图片和不支持的格式", async () => {
    const caller = createCaller();
    const fetchMock = vi.fn(async () =>
      new Response("not an image", {
        headers: { "content-type": "text/plain" },
      }),
    );
    const loader = new OneBotImageLoader(caller, {
      fetch: fetchMock as typeof fetch,
    });

    await expect(
      loader.load([{ url: "http://127.0.0.1:6099/private" }]),
    ).rejects.toBeInstanceOf(UserFacingError);
    expect(fetchMock).not.toHaveBeenCalled();

    await expect(
      loader.load([{ url: "https://gchat.qpic.cn/large.jpg", fileSize: 8 * 1024 * 1024 + 1 }]),
    ).rejects.toMatchObject<UserFacingError>({
      publicMessage: "图片过大，请发送不超过 8 MB 的图片。",
    });

    await expect(
      loader.load(
        Array.from({ length: 5 }, (_, index) => ({
          url: `https://gchat.qpic.cn/${index}.png`,
        })),
      ),
    ).rejects.toMatchObject<UserFacingError>({
      publicMessage: "一次最多识别 4 张图片。",
    });

    await expect(
      loader.load([{ url: "https://gchat.qpic.cn/not-image" }]),
    ).rejects.toMatchObject<UserFacingError>({
      publicMessage: "图片格式不支持，请发送 JPG、PNG、WebP 或 GIF 图片。",
    });
  });
});
