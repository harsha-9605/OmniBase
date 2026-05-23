import React, { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { ReactRenderer } from '@tiptap/react'
import tippy from 'tippy.js'

const MentionList = forwardRef((props, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0)

  const selectItem = index => {
    const item = props.items[index]
    if (item) {
      props.command({ id: item.id, label: item.label })
    }
  }

  const upHandler = () => {
    setSelectedIndex((selectedIndex + props.items.length - 1) % props.items.length)
  }

  const downHandler = () => {
    setSelectedIndex((selectedIndex + 1) % props.items.length)
  }

  const enterHandler = () => {
    selectItem(selectedIndex)
  }

  useEffect(() => setSelectedIndex(0), [props.items])

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === 'ArrowUp') {
        upHandler()
        return true
      }
      if (event.key === 'ArrowDown') {
        downHandler()
        return true
      }
      if (event.key === 'Enter') {
        enterHandler()
        return true
      }
      return false
    },
  }))

  return (
    <div className="bg-[#222222] border border-white/10 rounded-lg shadow-2xl py-2 flex flex-col min-w-[300px] text-white">
      {props.items.length ? props.items.map((item, index) => (
        <button
          className={`flex items-center text-left px-4 py-1.5 cursor-pointer ${index === selectedIndex ? 'bg-[#0284c7]' : 'bg-transparent hover:bg-white/5'}`}
          key={index}
          onClick={() => selectItem(index)}
        >
          <div className="flex flex-col flex-1">
            <div className="flex items-center gap-2">
              {item.isSpecial ? (
                <svg className="w-4 h-4 text-white/70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 21h4V9H10v12zm7-11h-4V4h4v6zm-14 0h4v6H3v-6z"></path></svg>
              ) : (
                <div className="w-5 h-5 rounded flex items-center justify-center bg-[#d81b60] text-xs font-bold text-white shadow-sm">
                  {item.label ? item.label[0].toUpperCase() : '?'}
                </div>
              )}
              <span className="font-bold text-[14px]">{item.label}</span>
            </div>
            {item.description && <span className="text-[12px] text-white/70 ml-7">{item.description}</span>}
          </div>
        </button>
      )) : (
        <div className="px-4 py-2 text-white/50 text-[14px]">No results</div>
      )}
      <div className="mt-1 border-t border-white/5 pt-2 px-4 pb-0 text-[11px] text-white/40 flex items-center gap-4">
         <span>↑↓ to navigate</span>
         <span>↵ to select</span>
         <span>esc to dismiss</span>
      </div>
    </div>
  )
})

export default function getSuggestionConfig(items) {
  return {
    items: ({ query }) => {
      return items.filter(item => item.label.toLowerCase().includes(query.toLowerCase())).slice(0, 10)
    },
    render: () => {
      let component
      let popup

      return {
        onStart: props => {
          component = new ReactRenderer(MentionList, {
            props,
            editor: props.editor,
          })

          if (!props.clientRect) return

          popup = tippy('body', {
            getReferenceClientRect: props.clientRect,
            appendTo: () => document.body,
            content: component.element,
            showOnCreate: true,
            interactive: true,
            trigger: 'manual',
            placement: 'top-start',
          })
        },
        onUpdate(props) {
          component.updateProps(props)
          if (!props.clientRect) return
          popup[0].setProps({
            getReferenceClientRect: props.clientRect,
          })
        },
        onKeyDown(props) {
          if (props.event.key === 'Escape') {
            popup[0].hide()
            return true
          }
          return component.ref?.onKeyDown(props)
        },
        onExit() {
          popup[0].destroy()
          component.destroy()
        },
      }
    },
  }
}
