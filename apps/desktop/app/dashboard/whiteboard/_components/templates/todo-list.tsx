"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { TemplateProps } from ".";

interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
}

export const TodoListTemplate = ({
  id,
  width,
  height,
  data,
  onDataChange,
  onDelete,
}: TemplateProps) => {
  const title = (data.title as string) || "Todo List";
  const items = (data.items as TodoItem[]) || [];

  const updateItems = (newItems: TodoItem[]) => {
    onDataChange({ ...data, items: newItems });
  };

  const [newTaskInput, setNewTaskInput] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [newTitleInput, setNewTitleInput] = useState(title);

  return (
    <div
      className="border border-border bg-background shadow-sm rounded-lg flex flex-col gap-3"
      style={{ width, height }}
    >
      <div className="flex flex-col gap-0.5 w-full pt-3 px-3 pb-3 border-b bg-input/25 rounded-tl-lg rounded-tr-lg">
        <div className="flex flex-row items-center justify-between">
          {editingTitle ? (
            <input
              className="text-base font-semibold focus:outline-none bg-surface rounded"
              value={newTitleInput}
              onChange={(e) => setNewTitleInput(e.target.value)}
              onBlur={() => {
                onDataChange({ ...data, title: newTitleInput });
                setEditingTitle(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onDataChange({ ...data, title: newTitleInput });
                  setEditingTitle(false);
                }
              }}
            />
          ) : (
            <p
              className="text-base font-semibold"
              onClick={() => setEditingTitle(true)}
            >
              {title}
            </p>
          )}
          <p className="text-accent text-sm">
            {items.filter((item) => item.completed).length}/{items.length}
          </p>
        </div>
        <div className="w-full relative border bg-surface rounded-full h-3 overflow-hidden">
          <div
            className="absolute top-0 left-0 h-full bg-primary transition-all duration-300 ease-in-out"
            style={{
              width: `${(items.filter((item) => item.completed).length / items.length) * 100}%`,
            }}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1 overflow-y-auto w-full">
        {items.map((item) => (
          <label
            key={item.id}
            className="group flex flex-row justify-start items-center gap-2 hover:bg-surface/50 rounded px-2 py-1"
          >
            <Checkbox
              className="rounded-full shrink-0"
              checked={item.completed}
              onCheckedChange={(checked) => {
                const newItems = items.map((i) =>
                  i.id === item.id ? { ...i, completed: checked } : i,
                );
                updateItems(newItems as TodoItem[]);
              }}
            />
            <span
              className={
                item.completed
                  ? "line-through text-muted-foreground truncate grow"
                  : "truncate grow"
              }
            >
              {item.text}
            </span>
            <Button
              onClick={() => {
                const newItems = items.filter((i) => i.id !== item.id);
                updateItems(newItems as TodoItem[]);
              }}
              variant={"outline"}
              size={"icon-xs"}
              className="hidden group-hover:flex ml-auto shrink-0"
            >
              <Trash2 />
            </Button>
          </label>
        ))}
      </div>
      <div className="mt-auto w-full flex flex-row items-center gap-2 p-3 bg-input/25 border-t rounded-bl-lg rounded-br-lg">
        <Input
          onChange={(e) => {
            setNewTaskInput(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const newItem: TodoItem = {
                id: Date.now().toString(),
                text: newTaskInput,
                completed: false,
              };
              updateItems([...items, newItem]);
              setNewTaskInput("");
              e.currentTarget.blur();
            }
          }}
          placeholder="Add a new task..."
          value={newTaskInput}
        />
        <Button
          size={"icon-sm"}
          onClick={() => {
            const newItem: TodoItem = {
              id: Date.now().toString(),
              text: newTaskInput,
              completed: false,
            };
            updateItems([...items, newItem]);
            setNewTaskInput("");
          }}
        >
          <Plus />
        </Button>
      </div>
    </div>
  );
};
