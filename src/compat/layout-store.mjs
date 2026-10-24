import {AppError} from './security.mjs';
import {defaultLayout,validateLayout} from '../dashboard/layout.mjs';

/** Display preferences only: no grant, token, snapshot or synchronization access. */
export class LayoutStore {
 constructor(db,{now=()=>Date.now()}={}) {this.db=db;this.now=now;}
 async read(ownerId,channelId) {
  const row=await this.db.prepare('SELECT layout_json,revision,updated_at FROM analytics_dashboard_layouts WHERE owner_id=? AND channel_id=?').bind(ownerId,channelId).first();
  return row?{layout:validateLayout(JSON.parse(row.layout_json)),revision:row.revision,updatedAt:row.updated_at}:{layout:defaultLayout(),revision:0,updatedAt:null};
 }
 async save(ownerId,channelId,layout,revision) {
  const normalized=validateLayout(layout),now=this.now();
  // An outdated browser cannot overwrite a newer layout from another tab/device.
  const row=revision===0
   ?await this.db.prepare('INSERT INTO analytics_dashboard_layouts(owner_id,channel_id,layout_json,revision,updated_at) VALUES(?,?,?,1,?) ON CONFLICT(owner_id,channel_id) DO NOTHING RETURNING revision').bind(ownerId,channelId,JSON.stringify(normalized),now).first()
   :await this.db.prepare('UPDATE analytics_dashboard_layouts SET layout_json=?,revision=revision+1,updated_at=? WHERE owner_id=? AND channel_id=? AND revision=? RETURNING revision').bind(JSON.stringify(normalized),now,ownerId,channelId,revision).first();
  if(!row)throw new AppError('LAYOUT_CONFLICT','A newer layout was saved. Reload before saving again.',409);
  return {layout:normalized,revision:row.revision,updatedAt:now};
 }
}
