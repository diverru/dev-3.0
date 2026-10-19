export type ScrollAnchorHandle = { dispose(): void; reanchor(): void };
type Anchor = { element: HTMLElement; offset: number; scrollTop: number };

/**
 * WKWebView has no CSS scroll anchoring and Chromium's loses the anchor while lazy diff
 * sections build, so the region keeps its first visible candidate in place by itself.
 * A candidate marked `data-scroll-anchor-pending` is about to grow, so it is a last-choice anchor.
 * Call `reanchor()` right after a programmatic scroll computed against the current layout.
 */
export function anchorScrollRegion(region: HTMLElement, candidateSelector: string): ScrollAnchorHandle {
	if (typeof ResizeObserver === "undefined") return { dispose() {}, reanchor() {} };

	let anchor: Anchor | null = null;

	function pickAnchor(): Anchor | null {
		const regionTop = region.getBoundingClientRect().top;
		const regionBottom = regionTop + region.clientHeight;
		let straddling: HTMLElement | null = null;
		let pending: HTMLElement | null = null;
		for (const element of region.querySelectorAll<HTMLElement>(candidateSelector)) {
			const rect = element.getBoundingClientRect();
			if (rect.top >= regionTop) {
				if (rect.top >= regionBottom) break;
				if (!element.hasAttribute("data-scroll-anchor-pending")) {
					return { element, offset: rect.top - regionTop, scrollTop: region.scrollTop };
				}
				pending ??= element;
			} else if (rect.bottom > regionTop) {
				straddling = element;
			}
		}
		const builtStraddling = straddling && !straddling.hasAttribute("data-scroll-anchor-pending") ? straddling : null;
		const fallback = builtStraddling ?? pending ?? straddling;
		return fallback
			? { element: fallback, offset: fallback.getBoundingClientRect().top - regionTop, scrollTop: region.scrollTop }
			: null;
	}

	function sync() {
		if (anchor && anchor.element.isConnected && anchor.scrollTop > 0) {
			const expected = anchor.offset - (region.scrollTop - anchor.scrollTop);
			const actual = anchor.element.getBoundingClientRect().top - region.getBoundingClientRect().top;
			const drift = actual - expected;
			if (Math.abs(drift) >= 1) region.scrollTop += drift;
		}
		anchor = pickAnchor();
	}

	const resizeObserver = new ResizeObserver(sync);
	const mutationObserver = new MutationObserver((records) => {
		for (const record of records) {
			record.removedNodes.forEach((node) => {
				if (node instanceof Element) resizeObserver.unobserve(node);
			});
			record.addedNodes.forEach((node) => {
				if (node instanceof Element) resizeObserver.observe(node);
			});
		}
	});

	for (const child of Array.from(region.children)) resizeObserver.observe(child);
	mutationObserver.observe(region, { childList: true });
	region.addEventListener("scroll", sync, { passive: true });
	sync();

	return {
		dispose() {
			region.removeEventListener("scroll", sync);
			resizeObserver.disconnect();
			mutationObserver.disconnect();
		},
		reanchor() {
			anchor = pickAnchor();
		},
	};
}
