import {
    _decorator, Component, Node, Sprite, SpriteFrame, UITransform, Label,
    resources, view, Vec3, Vec2, EventTouch, sp,
    RigidBody2D, PhysicsSystem2D, Contact2DType, IPhysics2DContact, Collider2D, PolygonCollider2D
} from 'cc';
const { ccclass, property } = _decorator;

interface GameConfig {
    state1_duration: number;
    state2_duration: number;
    charge_pool_threshold: number;
    combo_time_window: number;
    combo_text_3: string;
    combo_text_5: string;
}

const DEFAULT_CONFIG: GameConfig = {
    state1_duration: 1,
    state2_duration: 3,
    charge_pool_threshold: 30,
    combo_time_window: 3,
    combo_text_3: 'Perfect',
    combo_text_5: 'Unbelievable',
};

@ccclass('SkiGame')
export class SkiGame extends Component {

    @property(Node) bgFirst: Node = null!;
    @property([Node]) bgLoopNodes: Node[] = [];
    @property(Node) roadFirst: Node = null!;
    @property([Node]) roadLoopNodes: Node[] = [];
    @property(Node) cloud1: Node = null!;
    @property(Node) cloud2: Node = null!;
    @property(Node) cloud3: Node = null!;
    @property(Node) skier: Node = null!;
    @property(Node) startBtn: Node = null!;
    @property(Node) btn2x: Node = null!;
    @property(Node) btn4x: Node = null!;
    @property(Node) btnFall: Node = null!;
    @property(Node) sprintEffect: Node = null!;
    @property(Node) coinContainer: Node = null!;
    @property(Label) scoreLabel: Label = null!;

    @property bgScrollSpeed: number = 800;
    @property cloudSpeed: number = 30;
    @property speedSmooth: number = 1.2;
    @property coinInterval: number = 0.8;
    @property coinPickupRadius: number = 120;

    // ---- 物理相关 ----
    private _rb: RigidBody2D = null!;
    private _onGround = false;
    private _contactNormal: Vec2 = new Vec2(0, 1);

    private _coinFrame: SpriteFrame = null!;
    private _skeleton: sp.Skeleton = null!;
    private _ready = false;
    private _gameStarted = false;
    private _currentSpeed = 0;
    private _skierBaseX = 0;
    private _coinTimer = 0;
    private _score = 0;
    private _coins: Node[] = [];
    private _coinPool: Node[] = [];
    private _halfVisW = 640;

    private _currentState = 0;
    private _stateTimer = 0;
    private _coolDownTimer = 0;
    private _isPunished = false;
    private _chargePool = 0;
    private _gameOver = false;
    private _status1Count = 0;
    private _status2Count = 0;
    private _status3Count = 0;
    private _config: GameConfig = { ...DEFAULT_CONFIG };

    private _effectFrames: SpriteFrame[] = [];
    private _effectSprite: Sprite = null!;
    private _effectFrame = 0;
    private _effectTimer = 0;

    private _bgFirstW = 0;
    private _bgFirstPassed = false;
    private _smoothAngle = 0;
    private _lastSkierY = 0;
    private _lastSkierYInited = false;

    start() {
        // 开启 2D 物理
        PhysicsSystem2D.instance.enable = true;
        PhysicsSystem2D.instance.gravity = new Vec2(0, -1500);

        this._skeleton = this.skier.getComponent(sp.Skeleton)!;
        this._rb = this.skier.getComponent(RigidBody2D)!;
        this._currentSpeed = this.bgScrollSpeed;
        this._skierBaseX = this.skier.position.x;

        const visSize = view.getVisibleSize();
        this._halfVisW = visSize.width / 2;

        // 背景首图
        const firstUT = this.bgFirst.getComponent(UITransform)!;
        firstUT.anchorX = 0;
        firstUT.anchorY = 0.5;
        this._bgFirstW = firstUT.width;

        let bgX = -this._halfVisW + this._bgFirstW;
        for (const node of this.bgLoopNodes) {
            const ut = node.getComponent(UITransform)!;
            ut.anchorX = 0;
            ut.anchorY = 0.5;
            node.setPosition(bgX, 0, 0);
            bgX += ut.width;
        }
        this.bgFirst.setPosition(-this._halfVisW, 0, 0);

        // 道路层
        let roadX = -this._halfVisW;
        for (const node of this.roadLoopNodes) {
            const ut = node.getComponent(UITransform)!;
            ut.anchorX = 0;
            ut.anchorY = 0;
            node.setPosition(roadX, 0, 0);
            roadX += ut.width;
        }

        // Spine 开始前就播放正常滑行动画
        if (this._skeleton) {
            this._skeleton.setAnimation(0, 'zhengchang', true);
        }

        // 碰撞监听
        PhysicsSystem2D.instance.on(Contact2DType.BEGIN_CONTACT, this.onBeginContact, this);
        PhysicsSystem2D.instance.on(Contact2DType.END_CONTACT, this.onEndContact, this);
        PhysicsSystem2D.instance.on(Contact2DType.PRE_SOLVE, this.onPreSolve, this);

        // 按钮
        if (this.startBtn) this.startBtn.on(Node.EventType.TOUCH_END, this.onStartClick, this);
        if (this.btn2x) this.btn2x.on(Node.EventType.TOUCH_END, () => this.onReceiveStatus(1, 0), this);
        if (this.btn4x) this.btn4x.on(Node.EventType.TOUCH_END, () => this.onReceiveStatus(2, 0), this);
        if (this.btnFall) this.btnFall.on(Node.EventType.TOUCH_END, () => this.onReceiveStatus(3, 0), this);

        if (this.btn2x) this.btn2x.active = false;
        if (this.btn4x) this.btn4x.active = false;
        if (this.btnFall) this.btnFall.active = false;

        if (this.sprintEffect) {
            this._effectSprite = this.sprintEffect.getComponent(Sprite)!;
            if (this._effectSprite) {
                this._effectSprite.sizeMode = Sprite.SizeMode.RAW;
                this._effectSprite.trim = false;
                this._effectSprite.type = Sprite.Type.SIMPLE;
            }
            this.sprintEffect.active = false;
        }

        this.registerGlobalFunctions();
        this.loadAssets();
    }

    // ---- 2D 物理碰撞回调 ----
    private _groundContacts = 0;

    private onBeginContact(a: Collider2D, b: Collider2D, contact: IPhysics2DContact) {
        if (a.node === this.skier || b.node === this.skier) {
            this._groundContacts++;
            this._onGround = true;
        }
    }

    private onEndContact(a: Collider2D, b: Collider2D, contact: IPhysics2DContact) {
        if (a.node === this.skier || b.node === this.skier) {
            this._groundContacts--;
            if (this._groundContacts <= 0) {
                this._groundContacts = 0;
                this._onGround = false;
            }
        }
    }

    private onPreSolve(a: Collider2D, b: Collider2D, contact: IPhysics2DContact) {
        if (a.node === this.skier || b.node === this.skier) {
            const wm = contact.getWorldManifold();
            if (wm && wm.normal) {
                if (a.node === this.skier) {
                    this._contactNormal.set(-wm.normal.x, -wm.normal.y);
                } else {
                    this._contactNormal.set(wm.normal.x, wm.normal.y);
                }
            }
        }
    }

    // ---- 安卓接口 ----
    private registerGlobalFunctions() {
        const self = this;
        (window as any).receiveStatusAndCoolDown = (status: number, coolDownTime: number) => {
            self.onReceiveStatus(status, coolDownTime);
        };
        (window as any).receiveCountAndScore = (s1: number, s2: number, s3: number, total: number) => {
            console.log(`收到统计: 状态1=${s1}, 状态2=${s2}, 状态3=${s3}, 总分=${total}`);
        };
        (window as any).getGoldAmount = () => self._score;
        (window as any).updateGameConfig = (config: Partial<GameConfig>) => {
            self._config = { ...self._config, ...config };
            (window as any).gameConfig = self._config;
            console.log('游戏配置已更新:', self._config);
        };
        (window as any).gameConfig = this._config;
        (window as any).goldAmount = 0;
    }

    private onReceiveStatus(status: number, coolDownTime: number) {
        if (this._gameOver || !this._gameStarted) return;
        if (this._coolDownTimer > 0) return;
        if (this._isPunished && (status === 1 || status === 2)) return;

        this._coolDownTimer = coolDownTime;

        if (status === 1) {
            this._status1Count++;
            this._currentState = 1;
            this._stateTimer = this._config.state1_duration;
            this._chargePool += this._config.state1_duration;
            this._skeleton.setAnimation(0, 'cong ci', true);
            this.showSprintEffect(false);
            if (this._chargePool >= this._config.charge_pool_threshold) {
                this._chargePool = 0;
                this._currentState = 2;
                this._stateTimer = this._config.state2_duration;
                this._status2Count++;
                this.showSprintEffect(true);
            }
        } else if (status === 2) {
            this._status2Count++;
            this._currentState = 2;
            this._stateTimer = this._config.state2_duration;
            this._chargePool = 0;
            this._skeleton.setAnimation(0, 'cong ci', true);
            this.showSprintEffect(true);
        } else if (status === 3) {
            this._status3Count++;
            this._currentState = 3;
            this._stateTimer = 2;
            this._isPunished = true;
            this._skeleton.setAnimation(0, 'shuaidao', false);
            this.showSprintEffect(false);
        }
    }

    private loadAssets() {
        resources.load('coin/spriteFrame', SpriteFrame, (err, frame) => {
            if (err) {
                resources.load('coin', SpriteFrame, (err2, frame2) => {
                    if (err2) { console.error('load coin failed:', err2); return; }
                    this._coinFrame = frame2; this._ready = true; this.updateScore();
                });
                return;
            }
            this._coinFrame = frame; this._ready = true; this.updateScore();
        });
        resources.loadDir('tx', SpriteFrame, (err, frames) => {
            if (err) { console.error('load tx failed:', err); return; }
            this._effectFrames = frames.sort((a, b) => a.name.localeCompare(b.name));
        });
    }

    onStartClick() {
        this._gameStarted = true;
        if (this.startBtn) this.startBtn.active = false;
        if (this.btn2x) this.btn2x.active = true;
        if (this.btn4x) this.btn4x.active = true;
        if (this.btnFall) this.btnFall.active = true;
    }

    update(dt: number) {
        if (!this._ready || !this._gameStarted || this._gameOver) return;

        this.updateStateTimer(dt);
        this.updateCoolDown(dt);
        this.scrollAll(dt);
        this.updateClouds(dt);
        this.updateCoins(dt);
        this.updateSprintEffect(dt);
        this.updateSkierPhysics(dt);
    }

    // ---- 物理驱动角色贴合雪面 ----
    private updateSkierPhysics(dt: number) {
        if (!this._rb) return;

        // 保持角色 X 不变
        const pos = this.skier.position;
        if (Math.abs(pos.x - this._skierBaseX) > 1) {
            this.skier.setPosition(this._skierBaseX, pos.y, pos.z);
        }

        if (!this._lastSkierYInited) {
            this._lastSkierY = pos.y;
            this._lastSkierYInited = true;
            return;
        }

        const deltaY = pos.y - this._lastSkierY;
        this._lastSkierY = pos.y;

        const vx = this._currentSpeed * dt;
        let targetAngle = 0;
        if (vx > 0.01) {
            targetAngle = Math.atan2(deltaY, vx) * (180 / Math.PI);
            targetAngle = Math.max(-30, Math.min(30, targetAngle));
        }

        // 地面上紧跟坡度，离地时缓慢回正
        const lerpSpeed = this._onGround ? 10 : 3;
        this._smoothAngle += (targetAngle - this._smoothAngle) * Math.min(1, lerpSpeed * dt);
        this.skier.setRotationFromEuler(0, 0, this._smoothAngle);
    }

    private updateStateTimer(dt: number) {
        if (this._stateTimer > 0) {
            this._stateTimer -= dt;
            if (this._stateTimer <= 0) {
                this._stateTimer = 0;
                if (this._currentState === 3) {
                    this._isPunished = false;
                    this._skeleton.setAnimation(0, 'qishen', false);
                    this._skeleton.setCompleteListener(() => {
                        this._currentState = 0;
                        this._skeleton.setAnimation(0, 'zhengchang', true);
                        this._skeleton.setCompleteListener(null!);
                    });
                } else {
                    this._currentState = 0;
                    this._skeleton.setAnimation(0, 'zhengchang', true);
                    this.showSprintEffect(false);
                }
            }
        }
    }

    private updateCoolDown(dt: number) {
        if (this._coolDownTimer > 0) {
            this._coolDownTimer -= dt;
            if (this._coolDownTimer < 0) this._coolDownTimer = 0;
        }
    }

    private getSpeedMultiplier(): number {
        if (this._currentState === 1) return 2;
        if (this._currentState === 2) return 4;
        if (this._currentState === 3) return 0;
        return 1;
    }

    private scrollAll(dt: number) {
        const mult = this.getSpeedMultiplier();
        let targetSpeed = this.bgScrollSpeed * mult;
        if (this._currentState === 3) {
            this._currentSpeed *= 0.985;
            if (this._currentSpeed < 1) this._currentSpeed = 0;
        } else {
            this._currentSpeed += (targetSpeed - this._currentSpeed) * Math.min(1, this.speedSmooth * dt);
        }
        const dx = this._currentSpeed * dt;

        // 背景滚动
        const fp = this.bgFirst.position;
        this.bgFirst.setPosition(fp.x - dx, fp.y, fp.z);
        for (const node of this.bgLoopNodes) {
            const p = node.position;
            node.setPosition(p.x - dx, p.y, p.z);
        }
        if (!this._bgFirstPassed && this.bgFirst.position.x + this._bgFirstW <= -this._halfVisW) {
            this._bgFirstPassed = true;
            this.bgFirst.active = false;
        }
        for (const node of this.bgLoopNodes) {
            const w = node.getComponent(UITransform)!.width;
            if (node.position.x + w <= -this._halfVisW) {
                let maxRight = -99999;
                for (const other of this.bgLoopNodes) {
                    const oRight = other.position.x + other.getComponent(UITransform)!.width;
                    if (oRight > maxRight) maxRight = oRight;
                }
                node.setPosition(maxRight, 0, 0);
            }
        }

        // 道路滚动
        for (const node of this.roadLoopNodes) {
            const p = node.position;
            node.setPosition(p.x - dx, p.y, p.z);
        }
        for (const node of this.roadLoopNodes) {
            const w = node.getComponent(UITransform)!.width;
            if (node.position.x + w <= -this._halfVisW) {
                let maxRight = -99999;
                for (const other of this.roadLoopNodes) {
                    const oRight = other.position.x + other.getComponent(UITransform)!.width;
                    if (oRight > maxRight) maxRight = oRight;
                }
                node.setPosition(maxRight, node.position.y, 0);
                this.refreshRoadCollider(node);
            }
        }
    }

    private refreshRoadCollider(node: Node) {
        const collider = node.getComponent(PolygonCollider2D);
        if (collider) {
            collider.apply();
        }
    }

    private updateClouds(dt: number) {
        const clouds = [this.cloud1, this.cloud2, this.cloud3];
        const mult = this._currentState === 3 ? 0.5 : this._currentState >= 1 ? 2.0 : 1.0;
        const speeds = [this.cloudSpeed * mult, this.cloudSpeed * 0.6 * mult, this.cloudSpeed * 1.4 * mult];
        for (let i = 0; i < clouds.length; i++) {
            const cloud = clouds[i];
            if (!cloud) continue;
            const spd = speeds[i] * dt;
            const p = cloud.position;
            cloud.setPosition(p.x - spd, p.y, p.z);
            const w = cloud.getComponent(UITransform)!.width * cloud.scale.x;
            if (p.x + w < -this._halfVisW) {
                cloud.setPosition(this._halfVisW + Math.random() * 300, p.y, p.z);
            }
        }
    }

    private spawnCoin() {
        if (!this._coinFrame) return;
        // 3个(60%) 4个(25%) 5个(15%)
        const rand = Math.random();
        const count = rand < 0.6 ? 3 : rand < 0.85 ? 4 : 5;
        const baseX = this._halfVisW + 100;
        const baseY = this.skier.position.y + 80;
        const spacing = 60;

        for (let j = 0; j < count; j++) {
            let coin: Node;
            if (this._coinPool.length > 0) { coin = this._coinPool.pop()!; coin.active = true; }
            else {
                coin = new Node('Coin');
                const s = coin.addComponent(Sprite);
                s.spriteFrame = this._coinFrame;
                s.sizeMode = Sprite.SizeMode.RAW;
                s.trim = false;
                s.type = Sprite.Type.SIMPLE;
                coin.addComponent(UITransform);
            }
            coin.setPosition(baseX + j * spacing, baseY, 0);
            coin.setScale(0.5, 0.5, 1);
            if (coin.parent !== this.coinContainer) this.coinContainer.addChild(coin);
            this._coins.push(coin);
        }
    }

    private recycleCoin(coin: Node, index: number) {
        coin.active = false;
        this._coins.splice(index, 1);
        this._coinPool.push(coin);
    }

    private updateCoins(dt: number) {
        this._coinTimer += dt;
        if (this._coinTimer >= this.coinInterval) { this._coinTimer = 0; this.spawnCoin(); }
        const dx = this._currentSpeed * dt;
        const skierX = this.skier.position.x;
        const skierY = this.skier.position.y;
        const r = this.coinPickupRadius;
        for (let i = this._coins.length - 1; i >= 0; i--) {
            const coin = this._coins[i];
            coin.setPosition(coin.position.x - dx, coin.position.y, coin.position.z);
            const distX = Math.abs(coin.position.x - skierX);
            // 只判断 X 距离，确保能吃到
            if (!this._isPunished && distX < r) {
                this._score++;
                (window as any).goldAmount = this._score;
                this.updateScore();
                this.recycleCoin(coin, i);
                continue;
            }
            if (coin.position.x < -this._halfVisW - 50) this.recycleCoin(coin, i);
        }
    }

    private updateScore() { if (this.scoreLabel) this.scoreLabel.string = '' + this._score; }

    private showSprintEffect(show: boolean) {
        if (this.sprintEffect) {
            this.sprintEffect.active = show;
            this._effectFrame = 0;
            this._effectTimer = 0;
        }
    }

    private updateSprintEffect(dt: number) {
        if (!this.sprintEffect || !this.sprintEffect.active || this._effectFrames.length === 0) return;
        const p = this.skier.position;
        this.sprintEffect.setPosition(p.x, p.y, p.z);
        this._effectTimer += dt;
        if (this._effectTimer >= 0.06) {
            this._effectTimer = 0;
            this._effectFrame = (this._effectFrame + 1) % this._effectFrames.length;
            if (this._effectSprite) this._effectSprite.spriteFrame = this._effectFrames[this._effectFrame];
        }
    }

    onDestroy() {
        PhysicsSystem2D.instance.off(Contact2DType.BEGIN_CONTACT, this.onBeginContact, this);
        PhysicsSystem2D.instance.off(Contact2DType.END_CONTACT, this.onEndContact, this);
        PhysicsSystem2D.instance.off(Contact2DType.PRE_SOLVE, this.onPreSolve, this);
    }
}
