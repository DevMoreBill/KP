import { CoverThumb } from './cover-thumb.js';
import { DesignMouse } from './design-mouse.js';
import { DocImages } from './doc-images.js';
import { DocxWriter } from './docx-writer.js';
import { KpDocx } from './kp-docx.js';
import { KpFile } from './kp-file.js';
import { KpModels } from './kp-models.js';
import { LivePreview } from './live-preview.js';
import { KpPreview } from './kp-preview.js';
import { KpSave } from './kp-save.js';
import { PdfExport } from './pdf-export.js';
import { PreviewDocx } from './preview-docx.js';
import { TemplateDesigner } from './template-designer.js';
import { TemplateEditor } from './template-editor.js';
import { TemplateFields } from './template-fields.js';
import { Templates } from './templates.js';
import { KpSaved } from './kp-saved.js';
import { DocsGen } from './docs-gen.js';
import { DocLink } from '../../core/doc-link.js';
import { LISTS } from '../../core/lists.js';

export const DOC = {
  CoverThumb,
  DocImages,
  DocxWriter,
  KpDocx,
  KpFile,
  KpModels,
  LivePreview,
  KpPreview,
  KpSave,
  PdfExport,
  PreviewDocx,
  TemplateDesigner,
  TemplateEditor,
  TemplateFields,
  Templates,
  KpSaved,
};

Templates.listen();
TemplateEditor.listen();
CoverThumb.listen();
PdfExport.listen();
KpPreview.listen();
LivePreview.listen();
DesignMouse.listen();
LISTS.ready(TemplateFields.LISTS);
// КП просит документ (DocLink) — без import документа
DocLink.connect({
  docs: kpId => DocsGen.open(kpId),
  saving: () => KpSave.busy,
  templates: () => Templates.list,
  wantPreview: shown => LivePreview.want(shown),
  previewWanted: () => LivePreview.wanted(),
  previewMinWidth: () => LivePreview.MIN_WIDTH,
});
