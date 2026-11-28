"""Generate the public synthetic workbook using only Python standard-library ZIP/XML."""
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZipFile, ZIP_DEFLATED, ZipInfo
import csv
import json
import re

root = Path(__file__).resolve().parents[1]
columns = ["name", "email", "university", "interests", "subject", "body", "scheduled_at", "timezone", "follow_up_days", "follow_up_subject", "follow_up_body"]
example = ["Synthetic Professor", "controlled@example.com", "Example University", "Robotics and machine learning", "MS research inquiry - sample only", "Dear Professor,\nThis is synthetic sample content. Replace and review before approving.", "2099-01-01T12:00:00Z", "Asia/Karachi", "3", "Follow-up - sample only", "Dear Professor,\nFollowing up on my research inquiry. Thank you for your time."]
columns += ["follow_up_sequence", "follow_up_delay_value", "follow_up_delay_unit", "follow_up_relative_to"]
example += ["", "", "", ""]
maximum = int(re.search(r"MAX_FOLLOWUPS = (\d+)", (root / "shared/followup-sequence.ts").read_text()).group(1))
for step in range(1, maximum + 1):
    columns += [f"follow_up_{step}_{field}" for field in ["subject", "body", "delay_value", "delay_unit", "relative_to"]]
    example += [""] * 5
notes = [
    ["Instructions"],
    ["All example data is synthetic. No real professor is included."],
    ["Import in Professors. Email columns automatically prepare unapproved drafts for Gmail review."],
    ["Professor-only imports allow 500 rows; complete draft imports allow 25 rows and 5 MB."],
    ["scheduled_at accepts UTC ISO text (2099-01-01T12:00:00Z) or Excel date cells. Date cells require an explicit IANA timezone; Asia/Karachi means Pakistan wall time and Asia/Seoul means Korea wall time."],
    ["UTC ISO text is absolute and never shifted by timezone. Excel date cells and numeric serial dates are interpreted as wall time in the explicit timezone and converted to UTC; missing/ambiguous zones are rejected."],
    ["interests contains professor research details. Subject/body support multiline text."],
    ["follow_up_days is an integer 1-60 elapsed days after actual Gmail acceptance. Legacy followup_days is also supported."],
    ["Provide follow_up_days, follow_up_subject and follow_up_body together. Legacy followup_* columns remain supported; conflicting aliases are rejected."],
    ["Missing follow-up content is marked in review and cannot be authorized. Spreadsheet authorization columns are ignored."],
    ["Select all campaign drafts, review exact initial and follow-up content, select Gmail, then choose Approve initial emails and automatic follow-ups."],
    ["One campaign approval authorizes all displayed initial emails and exact conditional steps. All enabled recipients support up to ten exact spreadsheet-defined follow-ups. No missing follow-ups are added. No later approval is required."],
    ["Existing owner-controlled sending restrictions still apply. This template never activates sending or changes approved recipients."],
    ["Replies, declines, opt-outs and bounces stop tracked pending follow-ups. Reply access is required."],
    ["Every new upload creates a new campaign, even for previously contacted recipients or identical content and schedules. Retries within that upload reuse its drafts. Genuine opt-outs and account blocks remain enforced."],
]
notes += [
    ["Example JSON (clear legacy follow-up fields first): " + json.dumps([{"subject": "MS research inquiry - sample only", "body": f"Controlled test follow-up {index + 1}", "delay_value": delay, "delay_unit": "minutes", "relative_to": "previous"} for index, delay in enumerate([5, 10, 15, 30, 30])])],
    ["Flexible scheduling: clear follow_up_days and use follow_up_delay_value, follow_up_delay_unit (minutes/hours/days), follow_up_relative_to (original/previous), with follow_up_subject/body."],
    ["For 1-10 steps use numbered follow_up_1_subject/body/delay_value/delay_unit/relative_to through follow_up_10_*, OR a JSON array in follow_up_sequence. Do not mix timing formats."],
    ["Every due time is anchored to actual confirmed sends in UTC. Previous means the previous successfully confirmed follow-up. Steps execute in order; delays are earliest eligible times, not exact delivery promises."],
    ["Positive integer delays in minutes, hours or days are preserved exactly. Steps must be consecutive, increase in requested time, and finish within 60 days. Existing Gmail pacing and quotas can postpone delivery; no provider limits are bypassed."],
    ["Approval includes every displayed step and the maximum total message count. Replies, declines, opt-outs, cancellation and failed checks stop or postpone sends. Changes require a new campaign approval."],
]

def column_name(index):
    result = ""
    while index >= 0:
        result = chr(65 + index % 26) + result
        index = index // 26 - 1
    return result
def sheet(rows):
    xml = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
    for n, row in enumerate(rows, 1):
        xml += f'<row r="{n}">'
        for i, value in enumerate(row):
            ref = column_name(i) + str(n)
            xml += f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">{escape(str(value))}</t></is></c>'
        xml += '</row>'
    return xml + '</sheetData></worksheet>'
parts = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Professors" sheetId="1" r:id="rId1"/><sheet name="Instructions" sheetId="2" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': sheet([columns, example]),
    'xl/worksheets/sheet2.xml': sheet(notes),
}
with ZipFile(root / 'apps/web/public/professors-email-template.xlsx', 'w', ZIP_DEFLATED) as archive:
    for name, body in parts.items():
        info = ZipInfo(name, (2026, 10, 22, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        archive.writestr(info, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + body)
with (root / 'apps/web/public/professors-email-template.csv').open('w', newline='', encoding='utf-8') as output:
    writer = csv.writer(output)
    writer.writerows([columns, example])
