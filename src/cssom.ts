import { CSSOM_PROPERTIES, SHIFTED_PROPERTIES } from './cascade.js';

// Camel-case name to define on `CSSStyleDeclaration`, mapped to the CSS
// property it writes.
const PATCHED_PROPERTIES: Record<string, string> = Object.fromEntries(
  CSSOM_PROPERTIES.map((property) => [
    property.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase()),
    property,
  ]),
);

const PATCHED_CSS_PROPERTIES: string[] = Object.values(PATCHED_PROPERTIES);

let patched = false;

/**
 * Makes the anchor positioning properties settable through the CSSOM, so that
 * anchors wired up from JavaScript — `element.style.anchorName = '--foo'` — are
 * visible to the polyfill in browsers without native anchor positioning, which
 * drop what they do not know before it reaches the `style` attribute.
 *
 * The value is stored in the custom property `cascadeCSS` would have shifted the
 * declaration into anyway (`SHIFTED_PROPERTIES`), which the browser cannot drop,
 * and `cascadeCSS` restores it to the property it was set on. That keeps all the
 * bookkeeping out of here, so `CSSStyleDeclaration` is the only thing patched.
 *
 * This is opt-in, and does nothing when anchor positioning is supported
 * natively, because it has a side effect worth knowing about: defining these
 * properties makes `'anchorName' in document.documentElement.style` return
 * `true`, which is a common way to detect native support. Use
 * `CSS.supports('anchor-name: --a')` for that instead — it is unaffected.
 *
 * Values set before this is called are not picked up; call it as early as
 * possible, alongside the other patches.
 */
export function patchCSSOM() {
  if (patched || CSS.supports('anchor-name: --a')) return;
  patched = true;

  const { getPropertyPriority, getPropertyValue, removeProperty, setProperty } =
    CSSStyleDeclaration.prototype;

  // Writes through the native accessors, so the patched ones below can call
  // this without recursing.
  const writeValue = (
    style: CSSStyleDeclaration,
    cssProperty: string,
    value: string | null,
    priority?: string,
  ) => {
    const property = SHIFTED_PROPERTIES[cssProperty];
    const trimmed = `${value ?? ''}`.trim();
    if (trimmed) {
      setProperty.call(style, property, trimmed, priority);
    } else {
      removeProperty.call(style, property);
    }
  };

  // The name of the patched property `property` refers to, or `undefined` when
  // it isn't one of ours. CSS property names are ASCII case-insensitive, and
  // the CSSOM lowercases them before matching, so `'Anchor-Name'` has to be
  // recognized too -- falling through would hand it to the native
  // `setProperty`, which drops it. Custom property names are case-sensitive,
  // and are never ours.
  const patchedName = (property: string) => {
    const name = property.startsWith('--') ? property : property.toLowerCase();
    return PATCHED_CSS_PROPERTIES.includes(name) ? name : undefined;
  };

  // The property this declaration stores `cssProperty` in, for the properties
  // we own; anything else is passed through untouched, for the native method to
  // case-fold itself.
  const storedAs = (cssProperty: string) => {
    const patchedProperty = patchedName(cssProperty);
    return patchedProperty ? SHIFTED_PROPERTIES[patchedProperty] : cssProperty;
  };

  for (const [property, cssProperty] of Object.entries(PATCHED_PROPERTIES)) {
    Object.defineProperty(CSSStyleDeclaration.prototype, property, {
      configurable: true,
      enumerable: true,
      get(this: CSSStyleDeclaration) {
        return getPropertyValue.call(this, SHIFTED_PROPERTIES[cssProperty]);
      },
      set(this: CSSStyleDeclaration, value: string) {
        writeValue(this, cssProperty, value);
      },
    });
  }

  // The dashed form goes through these, and is dropped just the same.
  CSSStyleDeclaration.prototype.setProperty = function (
    property: string,
    value: string | null,
    priority?: string,
  ) {
    const patchedProperty = patchedName(property);
    if (patchedProperty) {
      writeValue(this, patchedProperty, value, priority);
      return;
    }
    return setProperty.call(this, property, value, priority);
  };

  CSSStyleDeclaration.prototype.getPropertyValue = function (
    property: string,
  ): string {
    return getPropertyValue.call(this, storedAs(property));
  };

  CSSStyleDeclaration.prototype.removeProperty = function (
    property: string,
  ): string {
    return removeProperty.call(this, storedAs(property));
  };

  // `setProperty` above stores the priority on the custom property, so reading
  // the literal name -- which was never written -- would always report none.
  CSSStyleDeclaration.prototype.getPropertyPriority = function (
    property: string,
  ): string {
    return getPropertyPriority.call(this, storedAs(property));
  };
}
