"use client";
import { useState } from "react";
import { Swiper, SwiperSlide } from "swiper/react";
import { Pagination } from "swiper/modules";
import "swiper/css";
import "swiper/css/pagination";

/**
 * Which field a slide keeps its picture in, by slide type.
 *
 * A slide is a block, and blocks disagree: an `image` block's picture is `url`,
 * a teaser-shaped slide's is `preview_image`. The annotation has to name the
 * field the data actually uses — `data-edit-media` is a claim about where the
 * edit lands, so naming the wrong one leaves the slide silently uneditable
 * (which is exactly what the gallery's image slides did).
 */
const SLIDE_MEDIA_FIELD = { image: "url" };
const mediaFieldOf = (slide) => SLIDE_MEDIA_FIELD[slide?.["@type"]] || "preview_image";

export default function SwiperSlider({ slides, apiUrl, imageProps, getUrl }) {
  const [swiper, setSwiper] = useState(null);
  return (
    <>
    {/* Room for the pagination. Swiper draws its bullets in a strip positioned
        absolutely over the bottom of the slider, and the slide's own content
        runs to the bottom edge — so the bullets sit ON TOP of the last thing in
        the slide, which is its link. A visitor sees text under the
        bullets; an author cannot click the link at all, because the bullets take
        the pointer events. Padding the container gives the strip its own space
        instead of borrowing the slide's. */}
    <Swiper
      modules={[Pagination]}
      pagination={{ clickable: true }}
      spaceBetween={50}
      onSwiper={setSwiper}
      style={{ paddingBottom: "2rem" }}
    >
      {/* Key by the item's OWN identity. expandListingBlocks stamps the
          listing's blockId onto every item it expands — deliberately, so the
          bridge can address them all as that block — so keying on @uid gives
          React duplicate keys and it omits or duplicates children ("Non-unique
          keys may cause children to be duplicated and/or omitted").
          @id is the content each item actually is, which also survives
          reordering and paging; position is only the fallback, since keying by
          index re-mounts every slide whenever the order changes. */}
      {slides.map((slide, slideIndex) => {
        const mediaField = mediaFieldOf(slide);
        // Read the field, never the slide as a whole: imageProps falls back to
        // an object's own @id, so handing it a slide with no picture yields the
        // slide's id as an image URL — a src that 404s on every slide.
        const mediaValue = slide[mediaField];
        const mediaUrl = mediaValue ? imageProps(mediaValue, apiUrl).url : null;
        return (
        <SwiperSlide key={slide["@id"] ?? `${slide["@uid"] ?? "slide"}-${slideIndex}`}>
          <div data-block-uid={slide["@uid"]} data-block-add="right">
            {mediaUrl ? (
              <img data-edit-media={mediaField} src={mediaUrl} alt="" style={{ width: "100%" }} />
            ) : (
              <div data-edit-media={mediaField} style={{ width: "100%", height: "300px", backgroundColor: "#374151" }} />
            )}
            {slide.head_title && <div data-edit-text="head_title">{slide.head_title}</div>}
            {slide.title && <h2 data-edit-text="title">{slide.title}</h2>}
            {slide.description && <p data-edit-text="description">{slide.description}</p>}
            {/* The <a> hosts TWO fields, so it exists when either has data —
                the same rule as every field above it. It used to render
                unconditionally with a literal "Read More", which invented a
                button on slides that have no button: an image slide is just
                {url, alt}, and the image schema declares neither buttonText nor
                href. Clicking that anchor could never start editing, because
                there is no field behind it to edit (issue #296: no data ⇒ no
                element). */}
            {(slide.buttonText || slide.href) && (
              <a
                href={slide.href ? getUrl(slide.href, apiUrl) : "#"}
                data-edit-link="href"
                data-edit-text="buttonText"
              >
                {slide.buttonText}
              </a>
            )}
          </div>
        </SwiperSlide>
        );
      })}
    </Swiper>
    {/* Reveal handles. A slide that is not the active one is hidden, and the
        editor has to be able to bring it into view when it is selected in the
        sidebar — the bridge clicks whatever advertises the uid it wants. Swiper's
        own bullets carry no such claim, so blocks on any slide but the first
        were unreachable here while working in the other frontends.

        The `+1` / `-1` controls are the fallback for a slide with no indicator
        of its own: the bridge steps until it arrives. */}
    <div className="slide-reveal-handles" style={{ display: "flex", gap: "0.25rem", justifyContent: "center", marginTop: "0.5rem" }}>
      <button type="button" aria-label="Previous slide" data-block-selector="-1"
              onClick={() => swiper?.slidePrev()}>‹</button>
      {slides.map((slide, index) => (
        <button key={slide["@id"] ?? `${slide["@uid"] ?? "slide"}-${index}`} type="button" aria-label={`Slide ${index + 1}`}
                data-block-selector={slide["@uid"]}
                onClick={() => swiper?.slideTo(index)}>{index + 1}</button>
      ))}
      <button type="button" aria-label="Next slide" data-block-selector="+1"
              onClick={() => swiper?.slideNext()}>›</button>
    </div>
    </>
  );
}
