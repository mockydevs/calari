"""Worker-only exports. CSV cells are safe to open in spreadsheet software."""
import csv
import io
import json
from html import escape


def csv_cell(value):
    if isinstance(value, (dict, list)):
        value = json.dumps(value, ensure_ascii=False, sort_keys=True)
    text = '' if value is None else str(value)
    if text.lstrip().startswith(('=', '+', '-', '@')) or text.startswith(('\t', '\r', '\n')):
        text = "'" + text
    return text


def render_csv(rows):
    stream = io.StringIO(newline='')
    fields = sorted({key for row in rows for key in row}) or ['id']
    writer = csv.writer(stream)
    writer.writerow([csv_cell(key) for key in fields])
    for row in rows:
        writer.writerow([csv_cell(row.get(key)) for key in fields])
    return '\ufeff' + stream.getvalue()


def render_pdf(run):
    # ReportLab avoids the Windows libgobject dependency of existing WeasyPrint
    # exports; generated content never loads URLs or executes HTML from GHL/AI.
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_LEFT
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer

    buffer = io.BytesIO()
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name='Detail', parent=styles['BodyText'], fontSize=9, leading=14, spaceAfter=7,
                              alignment=TA_LEFT, wordWrap='CJK'))
    document = SimpleDocTemplate(buffer, pagesize=(210 * mm, 297 * mm), rightMargin=20 * mm,
                                 leftMargin=20 * mm, topMargin=20 * mm, bottomMargin=20 * mm,
                                 title='GHL account conversation report', author='Internal workspace')
    content = []

    def paragraph(value, style='Detail'):
        text = escape(str(value)).replace('\n', '<br/>')
        content.append(Paragraph(text, styles[style]))

    paragraph('GHL account report', 'Title')
    snapshot = run.account_snapshot
    paragraph('SYNTHETIC DEMO - no live GHL data' if snapshot.get('synthetic') else 'Account-scoped API evidence', 'Heading2')
    paragraph(f"Account: {snapshot.get('name', '')} | Location: {snapshot.get('location_id', '')}")
    paragraph(f"Timezone: {snapshot.get('timezone', '')} | Run: {run.id}")
    paragraph(f"Requested: {run.created_at.isoformat()} | Status: {run.status}")
    paragraph(f"Date range: {run.plan.get('start_date') or 'Not specified'} through {run.plan.get('end_date') or 'Not specified'}")
    for heading, value in [('Question', run.question), ('Answer', run.answer)]:
        paragraph(heading, 'Heading2')
        paragraph(value)
    paragraph('Limitations', 'Heading2')
    for limitation in run.limitations:
        paragraph('- ' + limitation)
    paragraph('Evidence', 'Heading2')
    for item in run.evidence:
        paragraph(json.dumps(item, ensure_ascii=False, sort_keys=True, default=str))
    paragraph(f'Underlying result rows: {len(run.rows)}. Download the companion CSV for record-level evidence.')
    content.append(Spacer(1, 6 * mm))

    def footer(canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(colors.HexColor('#d8dee8'))
        canvas.line(20 * mm, 16 * mm, 190 * mm, 16 * mm)
        canvas.setFont('Helvetica', 8)
        canvas.drawString(20 * mm, 12 * mm, 'Private internal report | Review completeness before making decisions')
        canvas.drawRightString(190 * mm, 12 * mm, f'Page {doc.page}')
        canvas.restoreState()

    document.build(content, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()


def build_exports(run):
    run.csv_data = render_csv(run.rows)
    try:
        run.pdf = render_pdf(run)
        run.export_error = ''
    except Exception:
        # An unavailable renderer must not erase a completed API result or
        # encourage a user to repeat a write merely to obtain the PDF.
        run.pdf = None
        run.export_error = 'PDF rendering unavailable. The answer and CSV remain saved; ask an administrator to repair the PDF dependency.'
