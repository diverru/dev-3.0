import { useEffect, useRef, useState } from "react";
import type { ReviewComment } from "../../shared/review";
import { useT } from "../i18n";

const ICON = "'JetBrainsMono Nerd Font Mono'";

export interface ReviewThreadViewProps {
	comments: ReviewComment[];
	/** The thread's anchor, worded for the surface; printed once above the bubbles. */
	label: string;
	registerCommentRef: (commentId: string, element: HTMLDivElement | null) => void;
	editingCommentId: string | null;
	onStartEdit: (commentId: string) => void;
	onCancelEdit: () => void;
	onSaveEdit: (commentId: string, body: string) => void;
	onDeleteComment: (commentId: string) => void;
	onSendComment: (commentId: string) => void;
	/** Clears the resolved mark the agent set; replaces `Send` on a resolved bubble so the budget stays at three. */
	onReopenComment?: (commentId: string) => void;
	sendingCommentIds: Record<string, boolean>;
	/** Answers the agent in the thread; resolves to whether it was sent, so the draft survives a failure. */
	onReplyComment?: (commentId: string, body: string) => Promise<boolean>;
}

const SECONDARY_BUTTON = "dev3-inline-comment__button dev3-inline-comment__button--secondary inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-micro font-semibold transition-colors";

/**
 * One review thread — the bubbles under a diff line or beside an artifact pin —
 * with the agent's replies and the resolved state. Per-bubble actions stay at
 * three (Edit · Delete · Send, or Reopen once resolved), see the UX bible §5.3.
 */
export function ReviewThreadView({
	comments,
	label,
	registerCommentRef,
	editingCommentId,
	onStartEdit,
	onCancelEdit,
	onSaveEdit,
	onDeleteComment,
	onSendComment,
	onReopenComment,
	sendingCommentIds,
	onReplyComment,
}: ReviewThreadViewProps) {
	const t = useT();
	const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);
	const focusedEditCommentIdRef = useRef<string | null>(null);
	const [editingCommentDraft, setEditingCommentDraft] = useState("");

	useEffect(() => {
		if (!editingCommentId) {
			focusedEditCommentIdRef.current = null;
			return;
		}
		if (focusedEditCommentIdRef.current === editingCommentId) return;
		const textarea = editTextareaRef.current;
		if (!textarea) return;
		textarea.focus();
		const end = textarea.value.length;
		textarea.setSelectionRange(end, end);
		focusedEditCommentIdRef.current = editingCommentId;
	}, [editingCommentId]);

	return (
		<div
			className="dev3-inline-comment dev3-inline-comment--thread border-t border-edge bg-base/75 px-4 py-3 space-y-2"
			data-testid="inline-comment-thread"
		>
			<div className="dev3-inline-comment__meta text-micro font-semibold uppercase tracking-[0.08em] text-fg-muted">
				{label}
			</div>
			{comments.map((comment) => {
				const resolved = Boolean(comment.resolvedAt);
				return (
					<div
						key={comment.id}
						ref={(element) => registerCommentRef(comment.id, element)}
						data-inline-comment-id={comment.id}
						data-resolved={resolved ? "true" : undefined}
						className={`dev3-inline-comment__bubble scroll-mt-24 rounded-lg border px-3 py-2 ${resolved ? "border-success/40 bg-success/5" : "border-edge bg-raised"}`}
					>
						{editingCommentId === comment.id ? (
							<div className="space-y-2">
								<textarea
									ref={editTextareaRef}
									value={editingCommentDraft}
									onChange={(event) => setEditingCommentDraft(event.target.value)}
									rows={3}
									className="dev3-inline-comment__textarea w-full resize-y rounded-lg border border-edge bg-base px-3 py-2 text-sm text-fg outline-none transition-colors placeholder:text-fg-muted focus:border-edge-active focus:bg-elevated"
								/>
								<div className="flex items-center justify-end gap-2">
									<button
										type="button"
										onClick={onCancelEdit}
										className="dev3-inline-comment__button dev3-inline-comment__button--secondary inline-flex h-8 items-center justify-center rounded-md border border-edge bg-base px-3 text-xs font-semibold text-fg-2 transition-colors hover:bg-elevated-hover"
									>
										{t("infoPanel.diffCommentCancel")}
									</button>
									<button
										type="button"
										onClick={() => onSaveEdit(comment.id, editingCommentDraft)}
										disabled={!editingCommentDraft.trim()}
										aria-label={t("infoPanel.diffReviewSave")}
										className="dev3-inline-comment__button dev3-inline-comment__button--primary inline-flex h-8 items-center justify-center rounded-md border border-accent bg-accent-fill px-3 text-xs font-semibold text-white transition-colors hover:bg-accent-fill-hover disabled:cursor-not-allowed disabled:border-edge disabled:bg-base disabled:text-fg-muted"
									>
										{t("infoPanel.diffReviewSave")}
									</button>
								</div>
							</div>
						) : (
							<div className="space-y-2">
								{/* Wraps: in a narrow panel the action row drops under the text instead of squeezing it to one letter per line. */}
								<div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
									{/* min-w-0, not a floor: a 160px floor clipped the text in a phone-width aside. */}
									<div className="min-w-0 flex-1 basis-40 text-sm text-fg whitespace-pre-wrap break-words">
										{comment.body}
									</div>
									<div className="ml-auto flex flex-wrap items-center justify-end gap-1">
										{resolved ? (
											<button
												type="button"
												onClick={() => onReopenComment?.(comment.id)}
												disabled={!onReopenComment}
												data-testid="inline-comment-reopen"
												aria-label={t("infoPanel.diffReviewReopen")}
												className={`${SECONDARY_BUTTON} border-success/40 bg-success/10 text-success hover:bg-success/15 disabled:cursor-default`}
											>
												<span aria-hidden="true" className="text-sm-plus leading-none" style={{ fontFamily: ICON }}>{""}</span>
												<span>{t("infoPanel.diffReviewResolved")}</span>
											</button>
										) : (
											<button
												type="button"
												onClick={() => onSendComment(comment.id)}
												disabled={sendingCommentIds[comment.id]}
												data-testid="inline-comment-send"
												aria-label={t("infoPanel.diffReviewSendComment")}
												className={`${SECONDARY_BUTTON} ${
													comment.sentAt
														? "border-success/40 bg-success/10 text-success"
														: "border-edge bg-base text-fg-2 hover:bg-elevated-hover disabled:cursor-not-allowed disabled:text-fg-muted"
												}`}
											>
												<span aria-hidden="true" className="text-sm-plus leading-none" style={{ fontFamily: ICON }}>{""}</span>
												<span>
													{sendingCommentIds[comment.id]
														? t("infoPanel.diffReviewSendCommentSending")
														: comment.sentAt
															? t("infoPanel.diffReviewSendCommentSent")
															: t("infoPanel.diffReviewSendComment")}
												</span>
											</button>
										)}
										<button
											type="button"
											onClick={() => {
												setEditingCommentDraft(comment.body);
												onStartEdit(comment.id);
											}}
											aria-label={t("infoPanel.diffReviewEdit")}
											className="inline-flex h-7 items-center justify-center rounded-md border border-edge bg-base px-2 text-micro font-semibold text-fg-2 transition-colors hover:bg-elevated-hover"
										>
											{t("infoPanel.diffReviewEdit")}
										</button>
										<button
											type="button"
											onClick={() => onDeleteComment(comment.id)}
											aria-label={t("infoPanel.diffReviewDelete")}
											className="inline-flex h-7 items-center justify-center rounded-md border border-danger/25 bg-danger/10 px-2 text-micro font-semibold text-danger transition-colors hover:bg-danger/15"
										>
											{t("infoPanel.diffReviewDelete")}
										</button>
									</div>
								</div>
								{(comment.replies ?? []).map((reply) => (
									<div
										key={reply.id}
										data-testid="inline-comment-reply"
										className="rounded-md border-l-2 border-agent/60 bg-agent/10 px-2.5 py-1.5 text-sm text-fg whitespace-pre-wrap break-words"
									>
										<span className="mr-1.5 text-micro font-semibold uppercase tracking-[0.08em] text-fg-muted">
											{reply.author === "agent" ? t("infoPanel.diffReviewReplyAgent") : t("infoPanel.diffReviewReplyUser")}
										</span>
										{reply.body}
									</div>
								))}
								{onReplyComment && !resolved && Boolean(comment.sentAt || comment.replies?.length) && (
									<ReviewReplyField
										mode={comment.replies?.[comment.replies.length - 1]?.author === "agent" ? "reply" : "addition"}
										onSubmit={(body) => onReplyComment(comment.id, body)}
									/>
								)}
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}

/**
 * On every open thread the agent already received: `reply` when the agent has
 * the last word, `addition` otherwise. An unsent comment is edited instead.
 * Not a bubble action: the three-action budget stays intact.
 */
function ReviewReplyField({ mode, onSubmit }: { mode: "reply" | "addition"; onSubmit: (body: string) => Promise<boolean> }) {
	const t = useT();
	const [value, setValue] = useState("");
	const [sending, setSending] = useState(false);
	const trimmed = value.trim();
	const placeholder = mode === "reply" ? t("infoPanel.diffReviewReplyPlaceholder") : t("infoPanel.diffReviewAdditionPlaceholder");

	const submit = () => {
		if (!trimmed || sending) return;
		setSending(true);
		onSubmit(trimmed)
			.then((sent) => { if (sent) setValue(""); })
			.finally(() => setSending(false));
	};

	return (
		<form
			data-testid="inline-comment-reply-form"
			className="flex items-end gap-2"
			onSubmit={(event) => {
				event.preventDefault();
				submit();
			}}
		>
			<textarea
				value={value}
				onChange={(event) => setValue(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
						event.preventDefault();
						submit();
					}
				}}
				rows={1}
				disabled={sending}
				aria-label={placeholder}
				placeholder={placeholder}
				className="dev3-inline-comment__textarea min-w-0 flex-1 resize-y rounded-md border border-edge bg-base px-2.5 py-1.5 text-sm text-fg outline-none transition-colors placeholder:text-fg-muted focus:border-edge-active focus:bg-elevated disabled:opacity-60"
			/>
			<button
				type="submit"
				disabled={!trimmed || sending}
				data-testid="inline-comment-reply-send"
				className={`${SECONDARY_BUTTON} shrink-0 border-edge bg-base text-fg-2 hover:bg-elevated-hover disabled:cursor-not-allowed disabled:text-fg-muted`}
			>
				<span aria-hidden="true" className="text-sm-plus leading-none" style={{ fontFamily: ICON }}>{"\uf1d8"}</span>
				<span>{sending
					? t("infoPanel.diffReviewSendCommentSending")
					: mode === "reply" ? t("infoPanel.diffReviewReply") : t("infoPanel.diffReviewAddition")}</span>
			</button>
		</form>
	);
}
