package expo.modules.t3reviewdiff

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import kotlin.math.max

internal data class ReviewDiffCommentLayout(
  val title: String,
  val body: StaticLayout?,
  val bodyTop: Int,
  val width: Int,
  val height: Int,
)

internal class ReviewDiffCommentDrawing(
  private val density: Float,
  private val drawing: ReviewDiffCanvasDrawing,
) {
  private val commentTextPaint = TextPaint(Paint.ANTI_ALIAS_FLAG)
  private var layouts: Map<String, ReviewDiffCommentLayout> = emptyMap()

  fun clearCache() {
    layouts = emptyMap()
  }

  fun layout(
    row: DiffRow,
    viewWidth: Int,
    collapsed: Boolean,
    theme: DiffTheme,
    style: DiffStyle,
    titlePaint: Paint,
  ): ReviewDiffCommentLayout {
    val bodyWidth = max(
      1,
      (
        viewWidth -
          2f * COMMENT_CARD_HORIZONTAL_MARGIN_DP * density -
          2f * COMMENT_BODY_HORIZONTAL_PADDING_DP * density
        ).toInt(),
    )
    val title = "Comment on ${row.commentRangeLabel.ifEmpty { "line" }}"
    val bodyText = row.commentText.ifEmpty { "Comment" }
    val cacheKey =
      "${row.id}\u0000$bodyText\u0000$title\u0000$bodyWidth\u0000$collapsed\u0000" +
        "${theme.text}\u0000${style.fileHeaderSubtextFontSizePx}"
    layouts[cacheKey]?.let { return it }

    val layout = if (collapsed) {
      ReviewDiffCommentLayout(
        title = title,
        body = null,
        bodyTop = 0,
        width = bodyWidth,
        height = (COMMENT_COLLAPSED_HEIGHT_DP * density).toInt(),
      )
    } else {
      commentTextPaint.color = theme.text
      commentTextPaint.textSize = style.fileHeaderSubtextFontSizePx
      commentTextPaint.typeface = Typeface.DEFAULT
      val body = StaticLayout.Builder
        .obtain(bodyText, 0, bodyText.length, commentTextPaint, bodyWidth)
        .setAlignment(Layout.Alignment.ALIGN_NORMAL)
        .setIncludePad(false)
        .setLineSpacing(0f, 1f)
        .build()

      drawing.configureUiPaint(
        paint = titlePaint,
        color = theme.mutedText,
        size = style.fileHeaderSubtextFontSizePx,
        weight = style.fileHeaderSubtextFontWeight,
      )
      val titleBottomFromCard =
        COMMENT_TITLE_BASELINE_DP * density + titlePaint.fontMetrics.descent
      val bodyTop = (
        COMMENT_CARD_VERTICAL_MARGIN_DP * density +
          titleBottomFromCard +
          COMMENT_TITLE_GAP_DP * density
        ).toInt()
      ReviewDiffCommentLayout(
        title = title,
        body = body,
        bodyTop = bodyTop,
        width = bodyWidth,
        height = max(
          (COMMENT_EXPANDED_MIN_HEIGHT_DP * density).toInt(),
          (
            bodyTop + body.height +
              COMMENT_BODY_BOTTOM_PADDING_DP * density +
              COMMENT_CARD_VERTICAL_MARGIN_DP * density
            ).toInt(),
        ),
      )
    }
    layouts = layouts + (cacheKey to layout)
    return layout
  }

  fun draw(
    canvas: Canvas,
    row: DiffRow,
    top: Int,
    bottom: Int,
    viewWidth: Int,
    collapsed: Boolean,
    theme: DiffTheme,
    style: DiffStyle,
    backgroundPaint: Paint,
    borderPaint: Paint,
    textPaint: Paint,
    fillBackground: (Canvas, Int, Float, Float, Float, Float) -> Unit,
    withAlpha: (Int, Int) -> Int,
    ellipsize: (String, Paint, Float) -> String,
  ) {
    fillBackground(canvas, theme.background, 0f, top.toFloat(), viewWidth.toFloat(), bottom.toFloat())
    val cardRect = RectF(
      COMMENT_CARD_HORIZONTAL_MARGIN_DP * density,
      top + COMMENT_CARD_VERTICAL_MARGIN_DP * density,
      viewWidth - COMMENT_CARD_HORIZONTAL_MARGIN_DP * density,
      bottom - COMMENT_CARD_VERTICAL_MARGIN_DP * density,
    )
    backgroundPaint.color = theme.headerBackground
    canvas.drawRoundRect(cardRect, 10f * density, 10f * density, backgroundPaint)
    borderPaint.style = Paint.Style.STROKE
    borderPaint.color = withAlpha(theme.border, 217)
    borderPaint.strokeWidth = density
    canvas.drawRoundRect(cardRect, 10f * density, 10f * density, borderPaint)
    borderPaint.style = Paint.Style.FILL

    val commentLayout = layout(row, viewWidth, collapsed, theme, style, textPaint)
    val chevronRect = RectF(
      cardRect.left + 10f * density,
      cardRect.top + 11f * density,
      cardRect.left + 26f * density,
      cardRect.top + 27f * density,
    )
    drawing.drawDisclosureChevron(canvas, chevronRect, theme.mutedText, collapsed)
    drawing.configureUiPaint(
      paint = textPaint,
      color = theme.mutedText,
      size = style.fileHeaderSubtextFontSizePx,
      weight = style.fileHeaderSubtextFontWeight,
    )
    canvas.drawText(
      ellipsize(
        commentLayout.title,
        textPaint,
        cardRect.right - chevronRect.right - 20f * density,
      ),
      chevronRect.right + 10f * density,
      cardRect.top + COMMENT_TITLE_BASELINE_DP * density,
      textPaint,
    )
    val body = commentLayout.body
    if (!collapsed && body != null) {
      val bodyX = cardRect.left + COMMENT_BODY_HORIZONTAL_PADDING_DP * density
      canvas.save()
      canvas.clipRect(cardRect)
      canvas.translate(bodyX, (top + commentLayout.bodyTop).toFloat())
      body.draw(canvas)
      canvas.restore()
    }
  }

  companion object {
    private const val COMMENT_CARD_HORIZONTAL_MARGIN_DP = 8f
    private const val COMMENT_CARD_VERTICAL_MARGIN_DP = 5f
    private const val COMMENT_BODY_HORIZONTAL_PADDING_DP = 18f
    private const val COMMENT_TITLE_BASELINE_DP = 22f
    private const val COMMENT_TITLE_GAP_DP = 10f
    private const val COMMENT_BODY_BOTTOM_PADDING_DP = 14f
    private const val COMMENT_COLLAPSED_HEIGHT_DP = 44f
    private const val COMMENT_EXPANDED_MIN_HEIGHT_DP = 124f
  }
}
