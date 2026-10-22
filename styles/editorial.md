STYLEKIT_STYLE_REFERENCE
style_name: 编辑杂志风
style_slug: editorial
style_source: /styles/editorial

# Hard Prompt

## 什么时候用
当你希望 AI 严格按风格规则生成代码时使用。它是生产界面最稳的默认选择。

## 怎么用
- 把完整提示词复制到 ChatGPT、Claude、Cursor 或其他编码助手。
- 在提示词后追加具体产品、页面或组件需求。
- 生成后按禁止项和交互状态检查，确认没有风格漂移。

请严格遵守以下风格规则并保持一致性，禁止风格漂移。

## 执行要求

- 优先保证风格一致性，其次再做创意延展。
- 遇到冲突时以禁止项为最高优先级。
- 输出前自检：颜色、排版、间距、交互是否仍属于该风格。

## Style Rules

You are an Editorial design style frontend development expert. All generated code must strictly follow these constraints:

## 绝对禁止

- 禁止使用彩色强调色（红、蓝、绿等），保持纯单色体系
- 禁止使用粗边框或阴影（shadow-*）
- 禁止使用 #0a0a0a 纯黑或 #fafafa 冷白作为主色
- 禁止标题使用无衬线字体
- 禁止过小的行高，正文至少 leading-relaxed
- 禁止元素堆积，保持呼吸感
- 禁止使用渐变、背景图案或装饰性几何元素
- 禁止使用大圆角 rounded-xl 以上

## 必须遵守

- 标题使用衬线字体 font-serif，正文使用无衬线字体 font-sans
- 背景使用暖米色 bg-[#F9F8F6]，文字使用柔和黑 text-[#1C1C1C]
- 使用透明度层次构建灰度：text-[#1C1C1C]/60（次要）、/40（辅助）、/10（边框）
- 标签样式使用 font-sans text-xs tracking-[0.2em] uppercase
- Section 间距至少 py-24 md:py-40，容器内边距 px-6 md:px-12
- 链接和按钮使用 hover-underline 动画下划线效果
- 标题使用 tracking-tighter 紧凑字间距，hero 标题 text-6xl md:text-8xl 起步
- 斜体用于副标题或装饰性文字：italic text-[#1C1C1C]/60
- 表单使用底线输入框 + 浮动标签（peer-focus 模式）
- hover 交互使用 group-hover:italic 和微妙的 transition-all duration-500

## Core Palette

- Background: #F9F8F6 (warm cream, NOT pure white or #fafafa)
- Foreground: #1C1C1C (soft black, NOT #000 or #0a0a0a)
- Opacity hierarchy: text-[#1C1C1C]/60 (secondary), /40 (tertiary), /10 (borders/dividers)
- NO colored accents. This style is purely monochromatic.

## Typography

- Headings: font-serif, tracking-tighter, weight 400 (never bold)
- Hero titles: text-6xl md:text-8xl lg:text-[9rem] leading-[0.9]
- Labels: font-sans text-xs tracking-[0.2em] uppercase text-[#1C1C1C]/40
- Body: font-sans text-sm or text-base leading-relaxed text-[#1C1C1C]/80
- Italic for decorative subtitles: italic text-[#1C1C1C]/60

## Layout

- Section spacing: py-24 md:py-40 minimum
- Container: max-w-7xl mx-auto px-6 md:px-12
- Generous gaps: gap-12 lg:gap-24
- Content width: max-w-xs or max-w-md for body text
- Use 12-column grids: grid-cols-12 with col-span-5/col-span-7 splits

## Interactions

- Links: hover-underline animation (scaleX from right-to-left on hover)
- Titles: group-hover:italic transition-all duration-500
- Images: group-hover:scale-105 transition-transform duration-1000
- Arrows: group-hover:translate-x-2 transition-transform
- Borders: border-[#1C1C1C]/10, hover:bg-[#1C1C1C]/[0.02]

## Form Fields

- Bottom-border only: border-b border-[#1C1C1C]/20
- Floating labels with peer-focus pattern
- Input text: font-serif text-xl
- Focus: focus:border-[#1C1C1C] (no outline, no shadow, no ring)

## Navigation

- Fixed: fixed top-0 z-50 bg-[#F9F8F6]/90 backdrop-blur-sm
- Logo: font-serif text-lg tracking-[0.3em] uppercase
- Links: font-sans text-xs tracking-[0.2em] uppercase text-[#1C1C1C]/60

## Animation & Interaction Rules

- Cinematic Image Zoom: 配图区域应使用容器裁切 + 子元素慢速放大（如 `group-hover:scale-105 duration-1000`），保持时装大片式凝视感。
- Brutal Contrast: 交互对比应果断，但仅在既有调色盘中反转（`#1C1C1C` 与 `#F9F8F6`），禁止回退到纯黑纯白。
- Text Restraint: 文字本体不位移；hover 提示优先使用细线延展、字色加深等排版型反馈。
- Layout Lines: 分隔线 hover 时可从 `/10` 加深至 `/40`，用于强调网格骨架，不添加阴影和炫技动画。

---

# Editorial (编辑杂志风) Design System

> 优雅的杂志排版风格，衬线标题、无衬线正文、精致的留白和网格系统。灵感来自高端时尚杂志和报纸排版。暖米色背景、柔和黑文字、精细的透明度层次和动画下划线交互。

## 核心理念

Editorial（编辑杂志风）设计风格源于传统印刷媒体的排版美学，特别是高端时尚杂志和报纸的设计语言。这种风格强调内容的层次结构、精致的字体搭配和大量留白。

核心理念：
- 内容为王：设计服务于内容，不喧宾夺主。UI 是低声细语，不是大声喊叫
- 字体层次：衬线标题与无衬线正文形成对比，标签使用 uppercase tracking 增加呼吸感
- 留白即美：适当的负空间让内容呼吸，section 间距 py-24 md:py-40 起步
- 单色克制：仅使用 #1C1C1C 配合不同透明度（/60 /40 /10）构建视觉层次，拒绝彩色装饰
- 微妙动效：hover-underline 动画、clip-path reveal、group-hover:italic 等克制而精致的交互

---

## Token 字典（精确 Class 映射）

### 边框
```
宽度: border
颜色: border-border
圆角: rounded-none
```

### 阴影
```
小: shadow-none
中: shadow-none
大: shadow-none
悬停: shadow-none
聚焦: shadow-none
```

### 交互效果
```
悬停位移: （无）
悬停缩放: （无）
悬停透明度: hover:opacity-90
过渡动画: transition-colors duration-200
按下状态: active:scale-95
```

### 字体
```
标题: font-serif tracking-tight
正文: font-sans
等宽: font-mono
```

### 字号
```
Hero: text-4xl md:text-6xl lg:text-7xl
H1: text-3xl md:text-5xl
H2: text-2xl md:text-3xl
H3: text-xl md:text-2xl
正文: text-sm md:text-base
小字: text-xs
```

### 间距
```
Section: py-16 md:py-24 lg:py-32
容器: px-6 md:px-12
卡片: p-6
小间距: gap-4
中间距: gap-6 md:gap-8
大间距: gap-8 md:gap-12
```

### 颜色角色
```
背景主色: bg-background
背景辅色: bg-foreground
背景强调色: bg-[#e63946]
正文主色: text-foreground
正文辅色: text-background
正文弱化色: text-muted
按钮主色: bg-foreground text-background
按钮辅色: bg-transparent text-foreground
```

---

## [FORBIDDEN] 绝对禁止

以下 class 在本风格中**绝对禁止使用**，生成时必须检查并避免：

### 禁止的 Class
- `rounded-sm`
- `rounded`
- `rounded-md`
- `rounded-lg`
- `rounded-xl`
- `rounded-2xl`
- `rounded-3xl`
- `rounded-full`
- `shadow-sm`
- `shadow`
- `shadow-md`
- `shadow-lg`
- `shadow-xl`
- `shadow-2xl`
- `border-2`
- `border-4`
- `border-8`
- `bg-blue-500`
- `bg-green-500`
- `bg-yellow-500`

### 禁止的模式
- 匹配 `^rounded-(?!none)`
- 匹配 `^shadow-(?!none)`
- 匹配 `^border-[248]`
- 匹配 `^bg-gradient-`

### 禁止原因
- `rounded-lg`: Editorial uses sharp corners only (rounded-none)
- `shadow-lg`: Editorial avoids shadows completely
- `border-4`: Editorial uses thin borders only (border)
- `bg-gradient-to-r`: Editorial uses solid colors, no gradients
- `font-black`: Editorial headings use font-serif with normal weight, not bold

> WARNING: 如果你的代码中包含以上任何 class，必须立即替换。

---

## [REQUIRED] 必须包含

### 按钮必须包含
```
px-6 py-3
text-sm tracking-wide
transition-colors
```

### 卡片必须包含
```
border border-border
hover:border-foreground
transition-colors
```

### 输入框必须包含
```
border border-border
text-sm
focus:outline-none
focus:border-foreground
transition-colors
placeholder:text-muted
```

---

## [COMPARE] Editorial 错误 vs 正确对比

以下错误示例只代表“未经过当前风格适配的通用默认值”，不要把错误示例当成视觉建议。

### 按钮

[WRONG] **错误示例**（通用组件库默认样式，不要直接复制）：
```html
<button class="{GENERIC_LIBRARY_BUTTON_DEFAULT}">
  点击我
</button>
```

[CORRECT] **正确示例**（使用当前风格的 token）：
```html
<button class="px-6 py-3 text-sm tracking-wide transition-colors bg-foreground text-background">
  点击我
</button>
```

### 卡片

[WRONG] **错误示例**（未经当前风格适配的通用卡片）：
```html
<div class="{GENERIC_LIBRARY_CARD_DEFAULT}">
  <h3>{TITLE}</h3>
</div>
```

[CORRECT] **正确示例**（使用当前风格的 card token）：
```html
<div class="border border-border hover:border-foreground transition-colors p-6">
  <h3 class="font-serif tracking-tight text-xl md:text-2xl">{TITLE}</h3>
</div>
```

### 输入框

[WRONG] **错误示例**（未经当前风格适配的通用输入框）：
```html
<input class="{GENERIC_LIBRARY_INPUT_DEFAULT}" />
```

[CORRECT] **正确示例**（使用当前风格的 input token）：
```html
<input class="border border-border text-sm focus:outline-none focus:border-foreground transition-colors placeholder:text-muted" placeholder="{PLACEHOLDER}" />
```

---

## [TEMPLATES] Editorial 页面骨架模板

以下骨架只使用当前风格的 token。替换 `{PLACEHOLDER}` 时，不要移除或替换这些 token：

### 导航栏骨架
```html
<nav class="bg-background text-foreground border border-border px-6 md:px-12">
  <div class="flex items-center justify-between max-w-6xl mx-auto gap-6 md:gap-8">
    <a href="/" class="font-serif tracking-tight text-xl md:text-2xl">
      {LOGO_TEXT}
    </a>
    <div class="flex gap-6 md:gap-8 font-sans text-xs">
      {NAV_LINKS}
    </div>
  </div>
</nav>
```

### Hero 区块骨架
```html
<section class="bg-[#e63946] text-foreground py-16 md:py-24 lg:py-32 px-6 md:px-12">
  <div class="max-w-4xl mx-auto">
    <h1 class="font-serif tracking-tight text-4xl md:text-6xl lg:text-7xl">
      {HEADLINE}
    </h1>
    <p class="font-sans text-sm md:text-base max-w-xl">
      {SUBHEADLINE}
    </p>
    <button class="px-6 py-3 text-sm tracking-wide transition-colors bg-foreground text-background">
      {CTA_TEXT}
    </button>
  </div>
</section>
```

### 卡片网格骨架
```html
<section class="bg-background text-foreground py-16 md:py-24 lg:py-32 px-6 md:px-12">
  <div class="max-w-6xl mx-auto">
    <h2 class="font-serif tracking-tight text-2xl md:text-3xl">{SECTION_TITLE}</h2>
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
      <!-- Card template - repeat for each card -->
      <div class="border border-border hover:border-foreground transition-colors p-6">
        <h3 class="font-serif tracking-tight text-xl md:text-2xl">{CARD_TITLE}</h3>
        <p class="font-sans text-sm md:text-base text-muted">{CARD_DESCRIPTION}</p>
      </div>
    </div>
  </div>
</section>
```

### 表单输入骨架
```html
<input class="border border-border text-sm focus:outline-none focus:border-foreground transition-colors placeholder:text-muted" placeholder="{PLACEHOLDER}" />
```

### 页脚骨架
```html
<footer class="bg-foreground text-background py-16 md:py-24 lg:py-32 px-6 md:px-12">
  <div class="max-w-6xl mx-auto">
    <div class="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12">
      <div>
        <span class="font-serif tracking-tight text-xl md:text-2xl">{LOGO_TEXT}</span>
        <p class="font-sans text-xs">{TAGLINE}</p>
      </div>
      <div>
        <h4 class="font-serif tracking-tight text-xl md:text-2xl">{COLUMN_TITLE}</h4>
        <ul class="font-sans text-xs">
          {FOOTER_LINKS}
        </ul>
      </div>
    </div>
  </div>
</footer>
```

---

## [CHECKLIST] Editorial 生成后自检清单

**输出代码前，逐项验证当前风格的 token 和规则。如有违反，先修正再交付：**

### Token 检查
- [ ] 按钮包含： `px-6 py-3 text-sm tracking-wide transition-colors`
- [ ] 卡片包含： `border border-border hover:border-foreground transition-colors`
- [ ] 输入框包含： `border border-border text-sm focus:outline-none focus:border-foreground transition-colors placeholder:text-muted`

### 禁止项检查
- [ ] 没有使用 `rounded-sm`
- [ ] 没有使用 `rounded`
- [ ] 没有使用 `rounded-md`
- [ ] 没有使用 `rounded-lg`
- [ ] 没有使用 `rounded-xl`
- [ ] 没有使用 `rounded-2xl`
- [ ] 没有使用 `rounded-3xl`
- [ ] 没有使用 `rounded-full`

### 风格规则检查
- [ ] 标题使用衬线字体 font-serif，正文使用无衬线字体 font-sans
- [ ] 背景使用暖米色 bg-[#F9F8F6]，文字使用柔和黑 text-[#1C1C1C]
- [ ] 使用透明度层次构建灰度：text-[#1C1C1C]/60（次要）、/40（辅助）、/10（边框）
- [ ] 标签样式使用 font-sans text-xs tracking-[0.2em] uppercase
- [ ] Section 间距至少 py-24 md:py-40，容器内边距 px-6 md:px-12

### 风格漂移检查
- [ ] 没有违反：禁止使用彩色强调色（红、蓝、绿等），保持纯单色体系
- [ ] 没有违反：禁止使用粗边框或阴影（shadow-*）
- [ ] 没有违反：禁止使用 #0a0a0a 纯黑或 #fafafa 冷白作为主色
- [ ] 没有违反：禁止标题使用无衬线字体
- [ ] 没有违反：禁止过小的行高，正文至少 leading-relaxed

### 通用交付检查
- [ ] 响应式布局在手机、平板和桌面下稳定，没有横向溢出
- [ ] 所有交互元素有清晰焦点、可访问名称和 reduced-motion 方案
- [ ] 文本对比度达到 WCAG AA，且没有用颜色单独传递状态
- [ ] 结果仍然能够一眼识别为 Editorial

---

## [EXAMPLES] 示例 Prompt

### 1. 创意作品集

编辑杂志风格的创意设计师作品集

```
Use Editorial style to create a creative portfolio page:
1. Fixed nav: font-serif logo with tracking-[0.3em], hover-underline links
2. Hero: massive serif title (9rem+) with italic subtitle in #1C1C1C/60, clip-path image reveal
3. Featured works: numbered list (01, 02, 03) with hover image float and group-hover:italic
4. Infinite marquee ticker: services list with dot separators
5. Archive grid: masonry 2-col layout with staggered scroll reveals
6. About section: sticky portrait left, serif quote right, services/clients lists
7. Contact: floating-label inputs with bottom borders, hover-underline submit button
8. Palette: bg-[#F9F8F6], text-[#1C1C1C] with /60 /40 /10 opacity hierarchy only
```

### 2. 杂志风格博客

经典杂志排版的博客首页

```
Use Editorial style to create a magazine blog homepage:
1. Navigation: fixed top, bg-[#F9F8F6]/90 backdrop-blur, hover-underline links
2. Featured article: full-width grayscale image with clip-path reveal, serif title text-7xl
3. Article list: numbered editorial list with border-b border-[#1C1C1C]/10 dividers
4. Typography: font-serif headings tracking-tighter, font-sans text-xs labels with tracking-[0.2em] uppercase
5. Footer: minimal, text-xs uppercase with dot separators
6. Colors: monochrome only, #F9F8F6 background, #1C1C1C text with opacity variants
```

### 3. 工作室介绍

设计工作室的介绍页面

```
Use Editorial style to design a studio about page:
1. Layout: 12-col grid, col-span-5 sticky portrait + col-span-7 content
2. Hero quote: font-serif text-6xl with line breaks and italic decorative words
3. Body text: font-sans text-sm leading-relaxed text-[#1C1C1C]/80, max-w-xl
4. Services & clients: two-column grid with uppercase tracking labels, serif list items
5. Contact section: Say Hello heading text-8xl, floating-label form inputs
6. Interactions: IntersectionObserver scroll reveals, group-hover:italic on links
7. Palette: bg-[#F9F8F6], pure monochrome, NO accent colors
```

## 绝对禁止（匹配即拒绝）

以下模式一旦出现，视为风格违规——不找借口，直接重写。

- 使用彩色强调色（红、蓝、绿等），保持纯单色体系
- 使用粗边框或阴影（shadow-*）
- 使用 #0a0a0a 纯黑或 #fafafa 冷白作为主色
- 标题使用无衬线字体
- 过小的行高，正文至少 leading-relaxed
- 元素堆积，保持呼吸感
- 使用渐变、背景图案或装饰性几何元素
- 使用大圆角 rounded-xl 以上

## 自检清单（交付前逐条确认）

如果任何一条不通过，说明风格漂移了——修改后再交付。

- [ ] 没有紫色到蓝色的渐变
- [ ] 没有使用 Inter / Roboto / Geist 等过度使用的字体
- [ ] 没有嵌套卡片（卡片里面套卡片）
- [ ] 没有在彩色背景上放灰色文字
- [ ] 正文对比度满足 WCAG AA（≥4.5:1）
- [ ] 没有 bounce / elastic 缓动曲线
- [ ] 动效有 prefers-reduced-motion 备选方案
- [ ] 正文行宽不超过 65-75 个字符
- [ ] 没有单侧粗边框装饰（border-left/right accent stripe）
- [ ] 没有渐变文字（background-clip: text）
- [ ] 没有把玻璃态（glassmorphism）当作默认风格
- [ ] 没有 tiny uppercase tracked eyebrow 放在每个 section 标题上面
- [ ] 禁止使用彩色强调色（红、蓝、绿等），保持纯单色体系
- [ ] 禁止使用粗边框或阴影（shadow-*）
- [ ] 禁止使用 #0a0a0a 纯黑或 #fafafa 冷白作为主色
- [ ] 禁止标题使用无衬线字体
- [ ] 禁止过小的行高，正文至少 leading-relaxed