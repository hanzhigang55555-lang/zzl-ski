import { _decorator, Component, PolygonCollider2D, Sprite, UITransform, Vec2, Texture2D, ImageAsset } from 'cc';
const { ccclass, property } = _decorator;

// 静态缓存：按纹理 UUID 缓存扫描结果，同一张图只扫描一次
const _pointsCache: Map<string, Vec2[]> = new Map();

@ccclass('RoadColliderGen')
export class RoadColliderGen extends Component {

    @property({ tooltip: '采样步长(像素)' })
    sampleStep: number = 300;

    @property({ tooltip: 'Alpha 阈值' })
    alphaThreshold: number = 10;

    @property({ tooltip: '底部延伸像素' })
    bottomPadding: number = 200;

    private _cachedPoints: Vec2[] | null = null;

    start() {
        this.scheduleOnce(() => this.generateCollider(), 0);
    }

    generateCollider() {
        const sprite = this.node.getComponent(Sprite);
        if (!sprite || !sprite.spriteFrame) return;

        const tex = sprite.spriteFrame.texture as Texture2D;
        if (!tex) return;

        const ut = this.node.getComponent(UITransform)!;
        const anchorX = ut.anchorX;
        const anchorY = ut.anchorY;
        const nodeH = ut.height;

        const texUuid = tex._uuid || this.node.name;

        // 优先用缓存
        if (_pointsCache.has(texUuid)) {
            this._cachedPoints = _pointsCache.get(texUuid)!;
            this.applyCollider();
            return;
        }

        const image = tex.image as ImageAsset;
        if (!image || !image.data) return;

        const data = image.data as Uint8Array;
        const texW = tex.width;
        const texH = tex.height;
        const nodeW = ut.width;

        const topPoints: Vec2[] = [];
        const step = Math.max(1, Math.round(this.sampleStep));

        for (let nx = 0; nx <= nodeW; nx += step) {
            const texX = Math.min(Math.floor((nx / nodeW) * texW), texW - 1);
            let topY = -1;
            for (let ty = 0; ty < texH; ty++) {
                if (data[(ty * texW + texX) * 4 + 3] > this.alphaThreshold) {
                    topY = ty; break;
                }
            }
            if (topY >= 0) {
                topPoints.push(new Vec2(
                    nx - anchorX * nodeW,
                    (1 - topY / texH) * nodeH - anchorY * nodeH
                ));
            }
        }

        // 确保最右边缘有采样点
        const lastTexX = texW - 1;
        let lastTopY = -1;
        for (let ty = 0; ty < texH; ty++) {
            if (data[(ty * texW + lastTexX) * 4 + 3] > this.alphaThreshold) {
                lastTopY = ty; break;
            }
        }
        if (lastTopY >= 0 && topPoints.length > 0) {
            const lastLocalX = nodeW - anchorX * nodeW;
            const lastPt = topPoints[topPoints.length - 1];
            if (Math.abs(lastPt.x - lastLocalX) > 1) {
                topPoints.push(new Vec2(
                    lastLocalX,
                    (1 - lastTopY / texH) * nodeH - anchorY * nodeH
                ));
            }
        }

        if (topPoints.length < 2) return;

        // 缓存结果
        _pointsCache.set(texUuid, topPoints);
        this._cachedPoints = topPoints;
        this.applyCollider();
    }

    applyCollider() {
        if (!this._cachedPoints || this._cachedPoints.length < 2) return;

        const ut = this.node.getComponent(UITransform)!;
        const bottomY = -ut.anchorY * ut.height - this.bottomPadding;

        const points: Vec2[] = [];
        for (const p of this._cachedPoints) {
            points.push(new Vec2(p.x, p.y));
        }
        points.push(new Vec2(this._cachedPoints[this._cachedPoints.length - 1].x, bottomY));
        points.push(new Vec2(this._cachedPoints[0].x, bottomY));

        const collider = this.node.getComponent(PolygonCollider2D);
        if (collider) {
            collider.points = points;
            collider.apply();
        }
    }
}
