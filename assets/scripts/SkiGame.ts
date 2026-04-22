import { _decorator, Component, Node, Sprite, SpriteFrame, UITransform, Label, resources, view, Vec3, sp } from 'cc';
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
    @property(Node) bgLoopA: Node = null!;
    @property(Node) bgLoopB: Node = null!;
    @property(Node) roadFirst: Node = null!;
    @property(Node) roadLoopA: Node = null!;
    @property(Node) roadLoopB: Node = null!;
    @property(Node) cloud1: Node = null!;
    @property(Node) cloud2: Node = null!;
    @property(Node) cloud3: Node = null!;
    @property(Node) skier: Node = null!;
    @property(Node) startBtn: Node = null!;
    @property(Node) sprintEffect: Node = null!;
    @property(Node) coinContainer: Node = null!;
    @property(Label) scoreLabel: Label = null!;

    @property bgScrollSpeed: number = 800;
    @property cloudSpeed: number = 30;
    @property speedSmooth: number = 1.2;
    @property coinInterval: number = 1.5;
    @property coinPickupRadius: number = 60;
    @property enablePath: boolean = true;
    @property pathSmooth: number = 10;

    private _coinFrame: SpriteFrame = null!;
    private _skeleton: sp.Skeleton = null!;
    private _ready = false;
    private _gameStarted = false;
    private _currentSpeed = 0;
    private _skierBaseX = 0;
    private _currentPathY = 0;
    private _coinTimer = 0;
    private _score = 0;
    private _coins: Node[] = [];
    private _coinPool: Node[] = [];
    private _halfVisW = 640;
    private _scrollDistance = 0;

    private _currentState = 0; // 0=正常 1=加速 2=超级加速 3=摔倒
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
    private _bgLoopW = 0;
    private _roadFirstW = 0;
    private _roadLoopW = 0;
    private _bgFirstPassed = false;
    private _roadFirstPassed = false;

    private _firstPathPoints: number[][] = [
        [163,-271],[313,-245],[483,-236],[696,-249],[893,-269],[1177,-235],[1403,-256],[1617,-258],
        [1953,-242],[2137,-238],[2307,-264],[2490,-264],[2650,-244],[2787,-258],
    ];
    private _loopPathPoints: number[][] = [
        [0,-255],[250,-251],[470,-224],[703,-253],[934,-238],[1094,-247],[1300,-264],[1484,-251],
        [1723,-235],[1930,-260],[2070,-273],[2233,-242],[2410,-247],[2534,-266],[2667,-266],
        [2847,-244],[3010,-244],[3124,-245],[3280,-260],[3563,-262],[3663,-253],[3863,-266],
        [4037,-249],[4243,-244],[4394,-235],[4554,-258],[4697,-262],[4880,-253],[5017,-242],
        [5287,-247],[5434,-255],[5643,-240],[5847,-236],[6050,-266],[6314,-244],[6534,-256],
        [6847,-251],[7100,-238],[7340,-258],[7463,-269],[7674,-245],[7980,-273],[8327,-247],
        [8534,-231],[8727,-267],[8940,-255],[9067,-249],[9304,-264],[9517,-271],[9724,-249],[9853,-249],
    ];
    private _loopPathLength = 9853;
    private _firstPathEnd = 2934;

    start() {
        this._skeleton = this.skier.getComponent(sp.Skeleton)!;
        this._currentSpeed = this.bgScrollSpeed;
        this._skierBaseX = this.skier.position.x;
        this._currentPathY = this.skier.position.y;

        const visSize = view.getVisibleSize();
        this._halfVisW = visSize.width / 2;

        this.setupLayer(this.bgFirst, this.bgLoopA, this.bgLoopB);
        this._bgFirstW = this.bgFirst.getComponent(UITransform)!.width;
        this._bgLoopW = this.bgLoopA.getComponent(UITransform)!.width;
        this.bgFirst.setPosition(-this._halfVisW, 0, 0);
        this.bgLoopA.setPosition(-this._halfVisW + this._bgFirstW, 0, 0);
        this.bgLoopB.setPosition(-this._halfVisW + this._bgFirstW + this._bgLoopW, 0, 0);

        this.setupLayer(this.roadFirst, this.roadLoopA, this.roadLoopB);
        this._roadFirstW = this.roadFirst.getComponent(UITransform)!.width;
        this._roadLoopW = this.roadLoopA.getComponent(UITransform)!.width;
        this.roadFirst.setPosition(-this._halfVisW, 0, 0);
        this.roadLoopA.setPosition(-this._halfVisW + this._roadFirstW, 0, 0);
        this.roadLoopB.setPosition(-this._halfVisW + this._roadFirstW + this._roadLoopW, 0, 0);

        if (this._skeleton) {
            this._skeleton.setAnimation(0, 'zhengchang', false);
            this._skeleton.paused = true;
        }
        const initY = this.getPathY(0) + 100;
        this.skier.setPosition(this._skierBaseX, initY, 0);
        this._currentPathY = initY;

        if (this.startBtn) this.startBtn.on(Node.EventType.TOUCH_END, this.onStartClick, this);

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

    private setupLayer(first: Node, loopA: Node, loopB: Node) {
        for (const n of [first, loopA, loopB]) {
            const ut = n.getComponent(UITransform)!;
            ut.anchorX = 0;
            ut.anchorY = 0.5;
        }
    }

    // === 安卓接口：挂载到 window ===
    private registerGlobalFunctions() {
        const self = this;
        (window as any).receiveStatusAndCoolDown = (status: number, coolDownTime: number) => {
            self.onReceiveStatus(status, coolDownTime);
        };
        (window as any).receiveCountAndScore = (s1: number, s2: number, s3: number, total: number) => {
            console.log(`收到统计: 状态1=${s1}, 状态2=${s2}, 状态3=${s3}, 总分=${total}`);
        };
        (window as any).getGoldAmount = () => {
            return self._score;
        };
        (window as any).updateGameConfig = (config: Partial<GameConfig>) => {
            self._config = { ...self._config, ...config };
            (window as any).gameConfig = self._config;
            console.log('游戏配置已更新:', self._config);
        };
        (window as any).gameConfig = this._config;
        (window as any).goldAmount = 0;
    }
    // === 接收安卓端状态 ===
    private onReceiveStatus(status: number, coolDownTime: number) {
        if (this._gameOver || !this._gameStarted) return;
        // 冷却中忽略
        if (this._coolDownTimer > 0) return;
        // 摔倒惩罚中忽略状态1和2
        if (this._isPunished && (status === 1 || status === 2)) return;

        this._coolDownTimer = coolDownTime;

        if (status === 1) {
            this._status1Count++;
            this._currentState = 1;
            this._stateTimer = this._config.state1_duration;
            this._chargePool += this._config.state1_duration;
            this._skeleton.setAnimation(0, 'cong ci', true);
            this.showSprintEffect(true);
            // 蓄力池满了触发状态2
            if (this._chargePool >= this._config.charge_pool_threshold) {
                this._chargePool = 0;
                this._currentState = 2;
                this._stateTimer = this._config.state2_duration;
                this._status2Count++;
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
            this._stateTimer = 2; // 摔倒固定2秒
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
        if (this._skeleton) {
            this._skeleton.paused = false;
            this._skeleton.setAnimation(0, 'zhengchang', true);
        }
    }

    update(dt: number) {
        if (!this._ready || !this._gameStarted || this._gameOver) return;

        this.updateStateTimer(dt);
        this.updateCoolDown(dt);
        this.scrollAll(dt);
        this.updateClouds(dt);
        this.updateCoins(dt);
        this.updateSprintEffect(dt);

        if (this.enablePath) {
            const targetY = this.getPathY(this._scrollDistance) + 100;
            this._currentPathY += (targetY - this._currentPathY) * Math.min(1, this.pathSmooth * dt);
            const p = this.skier.position;
            this.skier.setPosition(p.x, this._currentPathY, p.z);
        }
    }

    private updateStateTimer(dt: number) {
        if (this._stateTimer > 0) {
            this._stateTimer -= dt;
            if (this._stateTimer <= 0) {
                this._stateTimer = 0;
                if (this._currentState === 3) {
                    // 摔倒结束，起身恢复
                    this._isPunished = false;
                    this._skeleton.setAnimation(0, 'qishen', false);
                    this._skeleton.setCompleteListener(() => {
                        this._currentState = 0;
                        this._skeleton.setAnimation(0, 'zhengchang', true);
                        this._skeleton.setCompleteListener(null!);
                    });
                } else {
                    // 状态1/2结束，恢复正常
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

    // === 速度倍率 ===
    private getSpeedMultiplier(): number {
        if (this._currentState === 1) return 2;
        if (this._currentState === 2) return 4;
        if (this._currentState === 3) return 0; // 摔倒不动
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
        this._scrollDistance += dx;

        this.scrollLayer(this.bgFirst, this.bgLoopA, this.bgLoopB, this._bgFirstW, this._bgLoopW, dx, 'bg');
        this.scrollLayer(this.roadFirst, this.roadLoopA, this.roadLoopB, this._roadFirstW, this._roadLoopW, dx, 'road');
    }

    private scrollLayer(first: Node, loopA: Node, loopB: Node, firstW: number, loopW: number, dx: number, tag: string) {
        first.setPosition(first.position.x - dx, first.position.y, first.position.z);
        loopA.setPosition(loopA.position.x - dx, loopA.position.y, loopA.position.z);
        loopB.setPosition(loopB.position.x - dx, loopB.position.y, loopB.position.z);

        const passed = tag === 'bg' ? this._bgFirstPassed : this._roadFirstPassed;
        if (!passed && first.position.x + firstW <= -this._halfVisW) {
            if (tag === 'bg') this._bgFirstPassed = true;
            else this._roadFirstPassed = true;
            first.active = false;
        }
        if (loopA.position.x + loopW <= -this._halfVisW) {
            loopA.setPosition(loopB.position.x + loopW, loopA.position.y, 0);
        }
        if (loopB.position.x + loopW <= -this._halfVisW) {
            loopB.setPosition(loopA.position.x + loopW, loopB.position.y, 0);
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
        coin.setPosition(this._halfVisW + 100, this.skier.position.y, 0);
        coin.setScale(0.5, 0.5, 1);
        if (coin.parent !== this.coinContainer) this.coinContainer.addChild(coin);
        this._coins.push(coin);
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
            const distX = coin.position.x - skierX;
            const distY = coin.position.y - skierY;
            // 摔倒时吃不到金币
            if (!this._isPunished && distX * distX + distY * distY < r * r) {
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

    private getPathY(dist: number): number {
        if (dist <= this._firstPathEnd) return this.lerpPoints(this._firstPathPoints, dist);
        return this.lerpPoints(this._loopPathPoints, (dist - this._firstPathEnd) % this._loopPathLength);
    }

    private lerpPoints(pts: number[][], d: number): number {
        if (pts.length === 0) return 0;
        if (d <= pts[0][0]) return pts[0][1];
        if (d >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
        for (let i = 0; i < pts.length - 1; i++) {
            if (d >= pts[i][0] && d <= pts[i + 1][0]) {
                const t = (d - pts[i][0]) / (pts[i + 1][0] - pts[i][0]);
                return pts[i][1] + t * (pts[i + 1][1] - pts[i][1]);
            }
        }
        return pts[pts.length - 1][1];
    }
}
