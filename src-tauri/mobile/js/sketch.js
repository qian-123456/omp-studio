"use strict";
/* Full-screen sketch pad. M.sketch.open(onDone(blob)) — exports a PNG on "完成". */
(function () {
	const COLORS = ["#111111", "#e5372e", "#f59e0b", "#22a559", "#2f6fed", "#8b5cf6", "#ffffff"];
	const WIDTHS = [3, 6, 12];

	function open(onDone) {
		const ov = document.createElement("div");
		ov.className = "sk-ov";
		ov.innerHTML =
			'<div class="sk-bar"><button class="sk-b" data-a="cancel">取消</button>' +
			'<span class="sk-sp"></span><button class="sk-b" data-a="undo">撤销</button>' +
			'<button class="sk-b" data-a="clear">清空</button>' +
			'<button class="sk-b primary" data-a="done">完成</button></div>' +
			'<div class="sk-stage"><canvas class="sk-cv"></canvas></div>' +
			'<div class="sk-tools"><div class="sk-colors">' +
			COLORS.map((c, i) => '<button class="sk-c' + (i === 0 ? " on" : "") + '" data-c="' + c + '" style="background:' + c + '" aria-label="颜色"></button>').join("") +
			'</div><div class="sk-widths">' +
			WIDTHS.map((w, i) => '<button class="sk-w' + (i === 1 ? " on" : "") + '" data-w="' + w + '" aria-label="粗细"><i style="width:' + (w + 4) + "px;height:" + (w + 4) + 'px"></i></button>').join("") +
			"</div></div>";
		document.body.appendChild(ov);
		const cv = ov.querySelector("canvas");
		const stage = ov.querySelector(".sk-stage");
		const ctx = cv.getContext("2d");
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		const W = Math.max(1, Math.round(stage.clientWidth));
		const H = Math.max(1, Math.round(stage.clientHeight));
		cv.width = W * dpr;
		cv.height = H * dpr;
		cv.style.width = W + "px";
		cv.style.height = H + "px";
		const strokes = [];
		let color = COLORS[0];
		let width = WIDTHS[1];
		let cur = null;

		function drawStroke(s) {
			ctx.strokeStyle = s.color;
			ctx.fillStyle = s.color;
			ctx.lineWidth = s.width * dpr;
			ctx.lineCap = "round";
			ctx.lineJoin = "round";
			const p = s.pts;
			if (p.length === 1) {
				ctx.beginPath();
				ctx.arc(p[0][0] * dpr, p[0][1] * dpr, (s.width * dpr) / 2, 0, Math.PI * 2);
				ctx.fill();
				return;
			}
			ctx.beginPath();
			ctx.moveTo(p[0][0] * dpr, p[0][1] * dpr);
			for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0] * dpr, p[i][1] * dpr);
			ctx.stroke();
		}
		function redraw() {
			ctx.fillStyle = "#ffffff";
			ctx.fillRect(0, 0, cv.width, cv.height);
			for (const s of strokes) drawStroke(s);
		}
		redraw();

		const pos = (e) => {
			const r = cv.getBoundingClientRect();
			return [e.clientX - r.left, e.clientY - r.top];
		};
		cv.style.touchAction = "none";
		cv.addEventListener("pointerdown", (e) => {
			cv.setPointerCapture(e.pointerId);
			cur = { color, width, pts: [pos(e)] };
			strokes.push(cur);
			redraw();
		});
		cv.addEventListener("pointermove", (e) => {
			if (!cur) return;
			cur.pts.push(pos(e));
			redraw();
		});
		const end = () => {
			cur = null;
		};
		cv.addEventListener("pointerup", end);
		cv.addEventListener("pointercancel", end);

		function close() {
			ov.remove();
		}
		ov.addEventListener("click", (e) => {
			const b = e.target.closest("button");
			if (!b) return;
			if (b.dataset.c) {
				color = b.dataset.c;
				ov.querySelectorAll(".sk-c").forEach((x) => x.classList.toggle("on", x === b));
			} else if (b.dataset.w) {
				width = +b.dataset.w;
				ov.querySelectorAll(".sk-w").forEach((x) => x.classList.toggle("on", x === b));
			} else if (b.dataset.a === "undo") {
				strokes.pop();
				redraw();
			} else if (b.dataset.a === "clear") {
				strokes.length = 0;
				redraw();
			} else if (b.dataset.a === "cancel") close();
			else if (b.dataset.a === "done") {
				if (strokes.length === 0) {
					M.toast("画布是空的");
					return;
				}
				// toBlob is async: a second tap before it lands would attach the sketch twice.
				if (b.disabled) return;
				b.disabled = true;
				cv.toBlob((blob) => {
					close();
					if (blob) onDone(blob);
					else M.toast("导出失败");
				}, "image/png");
			}
		});
	}

	M.sketch = { open };
})();
