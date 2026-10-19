import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { anchorScrollRegion } from "../scroll-anchor";

let fireResize: () => void;

class FakeResizeObserver {
	constructor(cb: () => void) {
		fireResize = () => { if (this.live) cb(); };
	}
	private live = true;
	observe() {}
	unobserve() {}
	disconnect() { this.live = false; }
}

function rect(top: number, height: number): DOMRect {
	return { top, bottom: top + height, height } as DOMRect;
}

// Region sits at viewport y=0 and is 500px tall; `layout.tops` places each file section in content space.
function setup(scrollTop: number, tops: number[], heights: number[] = [], pending: number[] = []) {
	const region = document.createElement("div");
	const layout = { scrollTop, tops };
	Object.defineProperty(region, "clientHeight", { value: 500 });
	Object.defineProperty(region, "scrollTop", {
		get: () => layout.scrollTop,
		set: (v: number) => { layout.scrollTop = v; },
	});
	region.getBoundingClientRect = () => rect(0, 500);
	tops.forEach((_, i) => {
		const el = document.createElement("div");
		el.dataset.fileId = String(i);
		if (pending.includes(i)) el.setAttribute("data-scroll-anchor-pending", "");
		el.getBoundingClientRect = () => rect(layout.tops[i] - layout.scrollTop, heights[i] ?? 1000);
		region.appendChild(el);
	});
	document.body.appendChild(region);
	return { region, layout };
}

describe("anchorScrollRegion", () => {
	beforeEach(() => {
		vi.stubGlobal("ResizeObserver", FakeResizeObserver);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		document.body.innerHTML = "";
	});

	it("keeps the anchor in place when a section above it grows", () => {
		const { region, layout } = setup(3000, [0, 2900, 4000]);
		anchorScrollRegion(region, "[data-file-id]");
		// section 1 straddles the top; section 0 above it grows by 5000
		layout.tops = [0, 7900, 9000];
		fireResize();
		expect(layout.scrollTop).toBe(8000);
	});

	it("does not compensate when scrollTop was 0", () => {
		const { region, layout } = setup(0, [0, 1000]);
		anchorScrollRegion(region, "[data-file-id]");
		layout.tops = [0, 6000];
		fireResize();
		expect(layout.scrollTop).toBe(0);
	});

	it("leaves scrollTop alone when growth is below the anchor", () => {
		const { region, layout } = setup(3000, [0, 2900, 4000]);
		anchorScrollRegion(region, "[data-file-id]");
		layout.tops = [0, 2900, 9000];
		fireResize();
		expect(layout.scrollTop).toBe(3000);
	});

	it("does not treat a user scroll as drift", () => {
		const { region, layout } = setup(3000, [0, 2900, 4000]);
		anchorScrollRegion(region, "[data-file-id]");
		layout.scrollTop = 3400;
		fireResize();
		expect(layout.scrollTop).toBe(3400);
	});

	it("keeps a programmatic scroll after reanchor", () => {
		const { region, layout } = setup(3000, [0, 2900, 4000]);
		const { reanchor } = anchorScrollRegion(region, "[data-file-id]");
		// scrollTo computed against the grown layout
		layout.tops = [0, 7900, 9000];
		layout.scrollTop = 7900;
		reanchor();
		fireResize();
		expect(layout.scrollTop).toBe(7900);
	});

	it("compensates growth when a user scroll was not yet seen by a scroll event", () => {
		const { region, layout } = setup(3000, [0, 2900, 4000]);
		anchorScrollRegion(region, "[data-file-id]");
		layout.scrollTop = 3400;
		layout.tops = [0, 7900, 9000];
		fireResize();
		expect(layout.scrollTop).toBe(8400);
	});

	it("stops compensating after dispose", () => {
		const { region, layout } = setup(3000, [0, 2900, 4000]);
		const { dispose } = anchorScrollRegion(region, "[data-file-id]");
		dispose();
		region.dispatchEvent(new Event("scroll"));
		layout.tops = [0, 7900, 9000];
		fireResize();
		region.dispatchEvent(new Event("scroll"));
		expect(layout.scrollTop).toBe(3000);
	});
});
